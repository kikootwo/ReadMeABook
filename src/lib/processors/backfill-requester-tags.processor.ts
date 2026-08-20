/**
 * Component: Backfill Requester Tags Processor
 * Documentation: documentation/features/requester-tags.md
 *
 * One-time backfill triggered when the ABS "tag requester" setting is toggled on.
 * Tags every already-available audiobook request's matched ABS item with the
 * requester's `req:<username>` tag. Tags are merged, so existing tags survive.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';

export interface BackfillRequesterTagsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processBackfillRequesterTags(payload: BackfillRequesterTagsPayload): Promise<any> {
  const { jobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'BackfillRequesterTags');

  logger.info('Starting requester-tag backfill for available audiobook requests...');

  try {
    const { getConfigService } = await import('../services/config.service');
    const configService = getConfigService();

    // Only meaningful for the Audiobookshelf backend.
    const backendMode = await configService.getBackendMode();
    if (backendMode !== 'audiobookshelf') {
      logger.warn(`Backend mode is '${backendMode}', not audiobookshelf — skipping backfill`);
      return { success: false, message: 'Not in Audiobookshelf mode', skipped: true };
    }

    const { addABSItemTags, formatRequesterTag } = await import('../services/audiobookshelf/api');

    // All available audiobook requests whose matched ABS item ID is known.
    const requests = await prisma.request.findMany({
      where: {
        status: 'available',
        type: 'audiobook',
        deletedAt: null,
        audiobook: { absItemId: { not: null } },
      },
      include: {
        audiobook: { select: { absItemId: true } },
        user: { select: { plexUsername: true } },
      },
    });

    logger.info(`Found ${requests.length} available requests to backfill`);

    let tagged = 0;
    let skipped = 0;

    for (const request of requests) {
      const itemId = request.audiobook.absItemId;
      const username = request.user.plexUsername;
      const tag = username ? formatRequesterTag(username) : '';

      // Skip when we can't form a usable tag (missing item ID, or a username
      // that sanitizes to nothing — see formatRequesterTag).
      if (!itemId || !tag) {
        skipped++;
        continue;
      }

      // Best-effort; addABSItemTags never throws and merges tags.
      await addABSItemTags(itemId, [tag]);
      tagged++;
    }

    logger.info(`Requester-tag backfill complete`, { tagged, skipped, total: requests.length });

    return {
      success: true,
      message: `Backfilled requester tags (${tagged} tagged, ${skipped} skipped)`,
      tagged,
      skipped,
      total: requests.length,
    };
  } catch (error) {
    logger.error('Requester-tag backfill failed', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
