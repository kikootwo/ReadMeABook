/**
 * Component: Send-to-E-Reader Job Processor
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Emails an organized ebook to the e-reader devices of everyone who requested the book
 * (audiobook or ebook), through Audiobookshelf's send-to-device API.
 *
 * Runs delayed and retried so ABS can scan the new file first. The ABS item is found by the folder
 * the ebook was put in, when known (ereader-item.ts), so a separate ebook library works too. Only
 * problems that happen before any email is sent throw (and so retry); per-device send failures are
 * logged instead. Devices
 * already emailed are recorded on the ebook request (`ereaderSentDevices`), so retries and
 * re-organizes never email a device twice, and someone who requests the book later still gets it.
 */

import * as path from 'path';
import { prisma } from '../db';
import { getConfigService } from '../services/config.service';
import { getEreaderDevices, sendEbookToDevice } from '../services/audiobookshelf/ereader';
import { findEbookItem } from '../services/audiobookshelf/ereader-item';
import { readPlacements } from '../utils/ebook-placement';
import { RMABLogger } from '../utils/logger';
import type { SendToEreaderPayload } from '../services/job-queue.service';

// Requesters in these states don't receive the ebook
const EXCLUDED_REQUEST_STATUSES = ['failed', 'cancelled', 'denied'];

/** A Prisma Json string-array field as a list of non-empty strings */
function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

export async function processSendToEreader(payload: SendToEreaderPayload): Promise<void> {
  const { requestId, targetUserIds, ebookFolder, jobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'SendToEreader');
  const configService = getConfigService();

  // 1. Re-check the gates: settings may have changed since the job was queued
  if ((await configService.get('ebook_ereader_auto_send_enabled')) !== 'true') {
    logger.info('E-reader delivery is off, skipping');
    return;
  }
  if ((await configService.getBackendMode()) !== 'audiobookshelf') {
    logger.warn('Backend mode is not Audiobookshelf, skipping e-reader delivery');
    return;
  }

  const ebookRequest = await prisma.request.findFirst({
    where: { id: requestId, deletedAt: null },
    include: { audiobook: true },
  });
  if (!ebookRequest) {
    logger.warn(`Ebook request ${requestId} not found, skipping`);
    return;
  }
  const { audiobook } = ebookRequest;
  const alreadySent = new Set(parseStringArray(ebookRequest.ereaderSentDevices));

  // 2. Recipients: the given users, else everyone who requested this book
  let userIds = targetUserIds ?? [];
  if (userIds.length === 0) {
    const requests = await prisma.request.findMany({
      where: { audiobookId: audiobook.id, deletedAt: null, status: { notIn: EXCLUDED_REQUEST_STATUSES } },
      select: { userId: true },
    });
    userIds = requests.map((r) => r.userId);
  }
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] }, deletedAt: null },
    select: { ereaderDeviceNames: true },
  });
  const wanted = new Set(users.flatMap((u) => parseStringArray(u.ereaderDeviceNames)).filter((d) => !alreadySent.has(d)));
  if (wanted.size === 0) {
    logger.info('No e-reader devices to send to (none enrolled, or all already sent)');
    return;
  }

  // 3. Keep only devices ABS still has and lets RMAB's token user send to
  const absDevices = new Map((await getEreaderDevices()).map((d) => [d.name, d]));
  const deviceNames = [...wanted].filter((name) => {
    const device = absDevices.get(name);
    if (!device) {
      logger.warn(`E-reader device "${name}" no longer exists in Audiobookshelf; skipping it`);
      return false;
    }
    if (!device.sendable) {
      logger.warn(
        `Audiobookshelf won't let RMAB's API token user send to "${name}": add that user to the device's ` +
        'allowed users in Audiobookshelf (Settings → Email), or make the device available to admins'
      );
      return false;
    }
    return true;
  });
  if (deviceNames.length === 0) return;

  // 4. Find the ABS item that holds the ebook, and wait (retry) until ABS lists the ebook on it
  const lookup = await findEbookItem({
    title: audiobook.title,
    author: audiobook.author,
    absItemId: audiobook.absItemId,
    folder: ebookFolder ?? placedEbookFolder(ebookRequest.placedEbookFiles),
  }, logger);
  if (!lookup.found) throw new Error(lookup.reason);
  const libraryItemId = lookup.itemId;

  // 5. Send, recording each device as it succeeds. Never throw from here: a retry would re-send.
  const newlySent: string[] = [];
  for (const deviceName of deviceNames) {
    try {
      await sendEbookToDevice(libraryItemId, deviceName);
      newlySent.push(deviceName);
    } catch (error) {
      logger.error(`Failed to send "${audiobook.title}" to "${deviceName}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (newlySent.length > 0) {
    await prisma.request.update({
      where: { id: ebookRequest.id },
      data: { ereaderSentDevices: [...new Set([...alreadySent, ...newlySent])] },
    });
    logger.info(`Sent "${audiobook.title}" to ${newlySent.length} device(s): ${newlySent.join(', ')}`);
  }
}

/** The folder of the newest ebook file this request's imports placed (#497), if any */
function placedEbookFolder(value: unknown): string | null {
  const entries = readPlacements(value)?.entries ?? [];
  const newest = entries[entries.length - 1];
  return newest ? path.dirname(newest.path) : null;
}
