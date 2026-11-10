/**
 * Component: Organize Library Placement (settings read, durable copy-fallback note, Hard link only refusal)
 * Documentation: documentation/features/library-placement.md
 */

import { prisma } from '../db';
import type { RMABLogger } from '../utils/logger';
import { getConfigService } from '../services/config.service';
import { getJobQueueService } from '../services/job-queue.service';
import { describeRefusal, type LinkRefusal } from '../utils/link-file';
import {
  FILE_PLACEMENT_KEY,
  LINK_FALLBACK_KEY,
  METADATA_OPF_KEY,
  effectiveLibrarySettings,
  parseFilePlacement,
  type FilePlacement,
} from '../utils/library-placement';
import type { OrganizationResult } from '../utils/file-organizer';

export interface ImportLibrarySettings {
  placement: FilePlacement;
  /** undefined when the tagging key could not be read: the organizer reads (and reports) it itself. */
  tagging: boolean | undefined;
  opf: boolean;
}

/**
 * This import's placement and metadata (library-placement.ts). Absent or unreadable
 * settings are today's behaviour: copy, no OPF. What the stored settings asked for and
 * this import won't do is logged.
 */
export async function readImportLibrarySettings(
  tagging: boolean | undefined,
  logger: RMABLogger
): Promise<ImportLibrarySettings> {
  let backendMode: string | undefined;
  let placement: FilePlacement = 'copy';
  let opf = false;
  try {
    const [placementRow, opfRow] = await Promise.all([
      prisma.configuration.findUnique({ where: { key: FILE_PLACEMENT_KEY } }),
      prisma.configuration.findUnique({ where: { key: METADATA_OPF_KEY } }),
    ]);
    placement = parseFilePlacement(placementRow?.value);
    opf = opfRow?.value === 'true';
    // Today's settings (copy, no OPF) need no backend read
    if (placement === 'copy' && !opf) return { placement, tagging, opf };
    backendMode = await getConfigService().getBackendMode();
  } catch (error) {
    logger.warn(`Could not read File placement or Metadata settings; copying without metadata.opf: ${error instanceof Error ? error.message : String(error)}`);
    return { placement: 'copy', tagging, opf: false };
  }
  const effective = effectiveLibrarySettings({ backendMode, placement, tagging: tagging ?? false, opf });
  effective.notes.forEach((note) => logger.info(note));
  if (effective.placement !== 'copy' || effective.opf) {
    logger.info(`File placement: ${effective.placement}; metadata.opf: ${effective.opf ? 'on' : 'off'}`);
  }
  // A failed tagging read stays undefined in copy mode, so the organizer reports it as before
  const keepUnread = tagging === undefined && effective.placement === 'copy' && !effective.opf;
  return { placement: effective.placement, tagging: keepUnread ? undefined : effective.tagging, opf: effective.opf };
}

/**
 * Keep the Paths page's "copied instead of linked" line after the request's own message is
 * cleared (a book that becomes available drops it): set on a copy fallback, cleared by a
 * later book that was linked. Never fails the import.
 */
export async function recordLinkOutcome(result: OrganizationResult, title: string, logger: RMABLogger): Promise<void> {
  try {
    if (result.linkFallback) {
      const value = JSON.stringify({ title, reason: describeRefusal(result.linkFallback), at: new Date().toISOString() });
      await prisma.configuration.upsert({
        where: { key: LINK_FALLBACK_KEY },
        update: { value },
        create: { key: LINK_FALLBACK_KEY, value, category: 'automation', description: 'Last book copied because a hard link was not possible' },
      });
    } else if ((result.linkedCount ?? 0) > 0) {
      await prisma.configuration.deleteMany({ where: { key: LINK_FALLBACK_KEY } });
    }
  } catch (error) {
    logger.warn(`Could not save the hard link note for the Paths page: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The request's message when Hard link only refused a book. */
export function linkRefusedMessage(refusal: LinkRefusal): string {
  return (
    `Not imported: hard link not possible (${refusal.words}, ${refusal.code}). Nothing was copied. ` +
    'Fix the mounts, or set File placement to Hard link (copy if not possible), then retry.'
  );
}

/**
 * Hard link only, client download: the request goes to `warn` with Retry (which re-runs the
 * import on the same download), one notification. Returned, never thrown, so no queue retry,
 * no import-attempt count and no auto-block of a good release.
 */
export async function refuseLinkedImport(
  requestId: string,
  refusal: LinkRefusal,
  logger: RMABLogger
): Promise<{ success: false; message: string; requestId: string }> {
  const message = linkRefusedMessage(refusal);
  await prisma.request.update({
    where: { id: requestId },
    data: { status: 'warn', errorMessage: message, updatedAt: new Date() },
  });
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: { audiobook: true, user: { select: { plexUsername: true } } },
  });
  if (request?.audiobook) {
    await getJobQueueService()
      .addNotificationJob('request_error', request.id, request.audiobook.title, request.audiobook.author, request.user?.plexUsername || 'Unknown User', message)
      .catch((error: unknown) => {
        logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
      });
  }
  return { success: false, message, requestId };
}
