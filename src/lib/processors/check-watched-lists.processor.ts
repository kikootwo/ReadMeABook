/**
 * Component: Check Watched Lists Processor
 * Documentation: documentation/features/watched-lists.md
 *
 * Dedicated processor for checking watched series and watched authors
 * for new releases and auto-creating requests.
 * Supports targeted processing of a single series/author for immediate sync.
 */

import { RMABLogger } from '../utils/logger';

export interface CheckWatchedListsPayload {
  jobId?: string;
  scheduledJobId?: string;
  /** If set, only process watched items for this user */
  userId?: string;
  /** If set, only process this specific series */
  seriesAsin?: string;
  /** If set, only process this specific author */
  authorAsin?: string;
}

export async function processCheckWatchedLists(payload: CheckWatchedListsPayload): Promise<any> {
  const { jobId, userId, seriesAsin, authorAsin } = payload;
  const logger = RMABLogger.forJob(jobId, 'CheckWatchedLists');

  const isTargeted = !!(userId && (seriesAsin || authorAsin));
  logger.info(isTargeted
    ? `Starting targeted watched lists check (user: ${userId}, series: ${seriesAsin || 'n/a'}, author: ${authorAsin || 'n/a'})...`
    : 'Starting watched lists check...'
  );

  const { processWatchedLists } = await import('../services/watched-lists.service');
  const stats = await processWatchedLists(logger, { userId, seriesAsin, authorAsin });

  logger.info('Watched lists check complete', { stats });

  return {
    success: true,
    message: isTargeted ? 'Targeted watched item checked' : 'Watched lists checked',
    ...stats,
  };
}
