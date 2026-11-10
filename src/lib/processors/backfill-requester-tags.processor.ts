/**
 * Component: Requester Tag Backfill Processor (#232)
 * Documentation: documentation/features/requester-tags.md
 *
 * Queued when the admin turns requester tagging on. Lists the configured Audiobookshelf library
 * once and runs the shared tagger in backfill mode: every eligible available request of a taggable
 * user whose item is listed, sequentially, uncapped. Stops when tagging is turned off or after
 * consecutive ABS failures. Idempotent.
 */

import { RMABLogger } from '../utils/logger';
import { getConfigService } from '../services/config.service';
import { getLibraryService } from '../services/library';
import { applyRequesterTags, isRequesterTaggingOn, REQUESTER_TAG_SETTING_KEY, type RequesterTagResult } from '../services/audiobookshelf/requester-tags';

export interface BackfillRequesterTagsPayload {
  jobId?: string;
}

export type BackfillRequesterTagsResult = RequesterTagResult | { skipped: true; reason: string };

export async function processBackfillRequesterTags(payload: BackfillRequesterTagsPayload): Promise<BackfillRequesterTagsResult> {
  const logger = RMABLogger.forJob(payload.jobId, 'RequesterTagBackfill');
  const configService = getConfigService();

  if ((await configService.getBackendMode()) !== 'audiobookshelf') {
    logger.info('Requester tags apply to Audiobookshelf only; skipping');
    return { skipped: true, reason: 'not_audiobookshelf' };
  }
  if (!(await isRequesterTaggingOn())) {
    logger.info('Requester tagging is off; skipping');
    return { skipped: true, reason: 'disabled' };
  }
  const libraryId = await configService.get('audiobookshelf.library_id');
  if (!libraryId) {
    logger.warn('Audiobookshelf library not configured; skipping');
    return { skipped: true, reason: 'no_library' };
  }

  const listedItems = await (await getLibraryService()).getLibraryItems(libraryId);
  logger.info(`Backfilling requester tags over ${listedItems.length} library items`);
  const result = await applyRequesterTags({
    deliveredBookIds: [],
    listedItems,
    logger,
    mode: 'backfill',
    shouldContinue: async () => {
      configService.clearCache(REQUESTER_TAG_SETTING_KEY);
      return isRequesterTaggingOn();
    },
  });
  logger.info(
    `Requester tag backfill: ${result.tagged} tagged, ${result.alreadyTagged} already tagged, ${result.failed} failed; ` +
    `skipped ${result.skippedShared} shared, ${result.skippedNoTag} without a tag, ${result.skippedUser} users, ` +
    `${result.skippedUnapproved} without approval, ${result.skippedImported} admin imports${result.stoppedEarly ? ' (stopped early)' : ''}`
  );
  return result;
}
