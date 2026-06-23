/**
 * Component: Send-to-E-Reader Job Processor
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Emails an organized ebook to the e-reader device(s) of every user who requested the book
 * (audiobook and/or ebook), via Audiobookshelf's send-to-device API.
 *
 * Runs delayed + retried so ABS has time to scan the newly organized file before lookup.
 * Idempotency: device names already sent are recorded on the ebook Request
 * (`ereaderSentDevices`), so retries/re-organizes never duplicate emails, and a user who
 * requests the book later still gets it (delivered only to their not-yet-sent devices).
 */

import { prisma } from '../db';
import { getConfigService } from '../services/config.service';
import {
  getABSLibraries,
  searchABSItems,
  sendEbookToDevice,
} from '../services/audiobookshelf/api';
import { RMABLogger } from '../utils/logger';
import type { SendToEreaderPayload } from '../services/job-queue.service';

// Requesters in these states are not considered eligible recipients
const EXCLUDED_REQUEST_STATUSES = ['failed', 'cancelled', 'denied'];

/** Parse a Prisma Json string-array field into a deduped list of strings. */
function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

export async function processSendToEreader(payload: SendToEreaderPayload): Promise<void> {
  const { ebookRequestId, audiobookId, title, author, targetUserIds, jobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'SendToEreader');

  const configService = getConfigService();

  // 1. Feature + backend gates (re-checked at runtime — may have changed since queue time)
  if ((await configService.get('ebook_ereader_auto_send_enabled')) !== 'true') {
    logger.info('E-reader auto-send disabled, skipping');
    return;
  }
  if ((await configService.getBackendMode()) !== 'audiobookshelf') {
    logger.warn('Backend mode is not Audiobookshelf, skipping e-reader send');
    return;
  }

  // 2. Load the ebook request (sent-tracking) and audiobook (lookup hints)
  const [ebookRequest, audiobook] = await Promise.all([
    prisma.request.findUnique({ where: { id: ebookRequestId } }),
    prisma.audiobook.findUnique({ where: { id: audiobookId } }),
  ]);
  if (!ebookRequest) {
    logger.warn(`Ebook request ${ebookRequestId} not found, skipping`);
    return;
  }
  if (!audiobook) {
    logger.warn(`Audiobook ${audiobookId} not found, skipping`);
    return;
  }

  const alreadySent = new Set(parseStringArray(ebookRequest.ereaderSentDevices));

  // 3. Resolve target users (#5/#6): explicit list, else everyone who requested this book
  let userIds: string[];
  if (targetUserIds && targetUserIds.length > 0) {
    userIds = Array.from(new Set(targetUserIds));
  } else {
    const requests = await prisma.request.findMany({
      where: {
        audiobookId,
        deletedAt: null,
        status: { notIn: EXCLUDED_REQUEST_STATUSES },
      },
      select: { userId: true },
    });
    userIds = Array.from(new Set(requests.map((r) => r.userId)));
  }
  if (userIds.length === 0) {
    logger.info('No eligible requesters, nothing to send');
    return;
  }

  // 4. Gather enrolled devices for those users, minus ones already sent
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { ereaderDeviceNames: true },
  });
  const devicesToSend = new Set<string>();
  for (const user of users) {
    for (const name of parseStringArray(user.ereaderDeviceNames)) {
      if (!alreadySent.has(name)) devicesToSend.add(name);
    }
  }
  if (devicesToSend.size === 0) {
    logger.info('No new e-reader devices to send to (none enrolled or all already sent)');
    return;
  }

  // 5. Resolve the ebook's ABS library item id
  const destinationMode = (await configService.get('ebook_destination_mode')) || 'same';
  let lookupLibraryId: string | null;
  if (destinationMode === 'library') {
    lookupLibraryId = await configService.get('ebook_destination_library_id');
  } else {
    lookupLibraryId = await configService.get('audiobookshelf.library_id');
  }

  let libraryItemId: string | undefined;
  // 'same' mode co-locates the ebook on the audiobook's item — prefer its matched id when present
  if (destinationMode === 'same' && audiobook.absItemId) {
    libraryItemId = audiobook.absItemId;
    logger.info(`Using matched audiobook ABS item ${libraryItemId}`);
  }
  if (!libraryItemId) {
    if (!lookupLibraryId) {
      logger.error('No ABS library id configured for ebook lookup; cannot resolve item');
      return; // config issue — retrying won't help
    }
    libraryItemId = await findLibraryItemId(lookupLibraryId, title, author, logger);
  }

  if (!libraryItemId) {
    // Not found yet — ABS scan likely still running. Throw to retry (no send has happened).
    throw new Error(
      `Ebook "${title}" not found in ABS library ${lookupLibraryId}. Scan may still be in progress.`
    );
  }

  // 6. Send to each device. Do NOT throw on per-device failure (avoid duplicate sends on retry).
  const newlySent: string[] = [];
  for (const deviceName of devicesToSend) {
    try {
      await sendEbookToDevice(libraryItemId, deviceName);
      newlySent.push(deviceName);
    } catch (error) {
      logger.error(
        `Failed to send "${title}" to device "${deviceName}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // 7. Persist sent devices (union with prior) so retries/re-organizes don't duplicate
  if (newlySent.length > 0) {
    const updated = Array.from(new Set([...alreadySent, ...newlySent]));
    await prisma.request.update({
      where: { id: ebookRequestId },
      data: { ereaderSentDevices: updated },
    });
    logger.info(`Sent "${title}" to ${newlySent.length} device(s): ${newlySent.join(', ')}`);
  }
}

/**
 * Find an ABS library item id for an ebook by title (preferring an exact title+author match).
 * Returns undefined if no candidate is found (caller treats this as "scan not ready yet").
 */
async function findLibraryItemId(
  libraryId: string,
  title: string,
  author: string,
  logger: RMABLogger
): Promise<string | undefined> {
  const results = await searchABSItems(libraryId, title);
  if (!results || results.length === 0) return undefined;

  // ABS search wraps each hit as { libraryItem }, but be defensive across shapes.
  const items = results.map((r: any) => r?.libraryItem ?? r).filter(Boolean);
  const wantTitle = title.trim().toLowerCase();
  const wantAuthor = author.trim().toLowerCase();

  const exact = items.find((it: any) => {
    const meta = it?.media?.metadata;
    const t = (meta?.title || '').trim().toLowerCase();
    const a = (meta?.authorName || '').trim().toLowerCase();
    return t === wantTitle && (!wantAuthor || a === wantAuthor);
  });

  // Accept an exact title+author match, or an exact-title match when author is unknown.
  // Do NOT fall back to a fuzzy search hit — emailing the wrong book is worse than not
  // delivering, so an inexact result is treated as "not found" (caller retries, then gives up).
  const titleOnly = items.find((it: any) => (it?.media?.metadata?.title || '').trim().toLowerCase() === wantTitle);
  const chosen = exact || titleOnly;
  if (!chosen?.id) {
    logger.warn(`No confident ABS title match for "${title}"; skipping send to avoid delivering the wrong book`);
    return undefined;
  }
  if (!exact) logger.info(`Matched ABS item ${chosen.id} for "${title}" by exact title (author not verified)`);
  return chosen.id as string;
}
