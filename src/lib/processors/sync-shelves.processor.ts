/**
 * Component: Sync Shelves Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Dedicated processor for syncing all reading shelves (Goodreads, Hardcover).
 * Resolves books to Audible ASINs and creates requests.
 */

import { RMABLogger } from '../utils/logger';

export interface SyncShelvesPayload {
  jobId?: string;
  scheduledJobId?: string;
  /** If set, only process this specific shelf (used for immediate sync on add) */
  shelfId?: string;
  /** The type of shelf, if shelfId is specified */
  shelfType?: 'goodreads' | 'hardcover';
  /** Max Audible lookups per shelf. 0 = unlimited. */
  maxLookupsPerShelf?: number;
}

export async function processSyncShelves(
  payload: SyncShelvesPayload,
): Promise<any> {
  const { jobId, shelfId, shelfType, maxLookupsPerShelf } = payload;
  const logger = RMABLogger.forJob(jobId, 'SyncShelves');

  const stats = {
    shelvesProcessed: 0,
    booksFound: 0,
    lookupsPerformed: 0,
    requestsCreated: 0,
    errors: 0,
  };

  logger.info(
    shelfId
      ? `Starting immediate ${shelfType} sync for list ${shelfId}...`
      : 'Starting scheduled shelves sync...',
  );

  const shouldSyncGoodreads = !shelfType || shelfType === 'goodreads';
  const shouldSyncHardcover = !shelfType || shelfType === 'hardcover';

  if (shouldSyncGoodreads) {
    try {
      const { processGoodreadsShelves } =
        await import('../services/goodreads-sync.service');
      const grStats = await processGoodreadsShelves(logger, {
        shelfId: shelfType === 'goodreads' ? shelfId : undefined,
        maxLookupsPerShelf: maxLookupsPerShelf ?? (shelfId ? 0 : undefined),
      });

      stats.shelvesProcessed += grStats.shelvesProcessed;
      stats.booksFound += grStats.booksFound;
      stats.lookupsPerformed += grStats.lookupsPerformed;
      stats.requestsCreated += grStats.requestsCreated;
      stats.errors += grStats.errors;
    } catch (error) {
      logger.error('Goodreads sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      stats.errors++;
    }
  }

  if (shouldSyncHardcover) {
    try {
      const { processHardcoverShelves } =
        await import('../services/hardcover-sync.service');
      const hcStats = await processHardcoverShelves(logger, {
        shelfId: shelfType === 'hardcover' ? shelfId : undefined,
        maxLookupsPerShelf: maxLookupsPerShelf ?? (shelfId ? 0 : undefined),
      });

      stats.shelvesProcessed += hcStats.shelvesProcessed;
      stats.booksFound += hcStats.booksFound;
      stats.lookupsPerformed += hcStats.lookupsPerformed;
      stats.requestsCreated += hcStats.requestsCreated;
      stats.errors += hcStats.errors;
    } catch (error) {
      logger.error('Hardcover sync failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      stats.errors++;
    }
  }

  logger.info('Shelves sync complete', { stats });

  return {
    success: true,
    message: shelfId ? `${shelfType} list synced` : 'Reading shelves synced',
    ...stats,
  };
}
