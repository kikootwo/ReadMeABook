/**
 * Component: Sync Hardcover Shelves Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Dedicated processor for syncing Hardcover lists.
 * Resolves books to Audible ASINs and creates requests.
 */

import { RMABLogger } from '../utils/logger';

export interface SyncHardcoverShelvesPayload {
  jobId?: string;
  scheduledJobId?: string;
  /** If set, only process this specific list (used for immediate sync on add) */
  shelfId?: string;
  /** Max Audible lookups per list. 0 = unlimited. */
  maxLookupsPerShelf?: number;
}

export async function processSyncHardcoverShelves(
  payload: SyncHardcoverShelvesPayload,
): Promise<any> {
  const { jobId, shelfId, maxLookupsPerShelf } = payload;
  const logger = RMABLogger.forJob(jobId, 'SyncHardcoverShelves');

  logger.info(
    shelfId
      ? `Starting immediate Hardcover sync for list ${shelfId}...`
      : 'Starting scheduled Hardcover lists sync...',
  );

  const { processHardcoverShelves } =
    await import('../services/hardcover-sync.service');
  const stats = await processHardcoverShelves(logger, {
    shelfId,
    maxLookupsPerShelf: maxLookupsPerShelf ?? (shelfId ? 0 : undefined),
  });

  logger.info('Hardcover sync complete', { stats });

  return {
    success: true,
    message: shelfId ? 'Hardcover list synced' : 'Hardcover lists synced',
    ...stats,
  };
}
