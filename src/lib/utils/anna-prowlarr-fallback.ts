/**
 * Component: Anna→Prowlarr Fallback Helper
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Atomic fallback from Anna's Archive direct download to Prowlarr indexer search.
 */

import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('AnnaProwlarrFallback');

/**
 * Atomically claim DownloadHistory transition to fallback_triggered and enqueue Prowlarr search.
 *
 * Uses a conditional Prisma update to ensure only one concurrent process wins the claim.
 * Losing duplicate/retry paths leave history untouched and do not enqueue/search/fail.
 *
 * @param requestId - The ebook request ID
 * @param downloadHistoryId - The DownloadHistory row ID
 * @param errorMessage - Error message to store (e.g., "Zero slow URLs available")
 */
export async function triggerFallbackToProwlarr(
  requestId: string,
  downloadHistoryId: string,
  errorMessage: string
): Promise<void> {
  logger.info(`Attempting fallback for request ${requestId}, download history ${downloadHistoryId}`);

  // STEP 1: Atomically claim the fallback transition
  // Only update if status is 'downloading' (not already fallback_triggered/failed/completed)
  const claimResult = await prisma.downloadHistory.updateMany({
    where: {
      id: downloadHistoryId,
      requestId,
      downloadStatus: 'downloading',
    },
    data: {
      downloadStatus: 'fallback_triggered',
      downloadError: errorMessage,
    },
  });

  // STEP 2: Check if we won the claim
  if (claimResult.count === 0) {
    // Lost the race - another process already claimed this row
    logger.info(`Fallback claim lost for ${downloadHistoryId} (already claimed or terminal status)`);
    return;
  }

  logger.info(`Fallback claim won for ${downloadHistoryId}, enqueueing Prowlarr search`);

  // STEP 3: Fetch request details to get audiobook info
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      audiobook: true,
    },
  });

  if (!request || !request.audiobook) {
    logger.error(`Request ${requestId} or audiobook not found`);
    return;
  }

  // STEP 4: Update Request.errorMessage with the error message
  await prisma.request.update({
    where: { id: requestId },
    data: {
      errorMessage,
    },
  });

  // STEP 5: Enqueue Prowlarr search job with isFallback=true
  const jobQueue = getJobQueueService();
  await jobQueue.addSearchEbookJob(
    requestId,
    {
      id: request.audiobook.id,
      title: request.audiobook.title,
      author: request.audiobook.author,
      asin: request.audiobook.audibleAsin || undefined,
    },
    undefined,
    { isFallback: true } // Flag to skip Anna's Archive in search
  );

  logger.info(`Enqueued fallback Prowlarr search for request ${requestId}`);
}