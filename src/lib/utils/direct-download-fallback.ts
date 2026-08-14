/**
 * Component: Direct Download Fallback Helper
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Atomic fallback from direct download (Anna's Archive) to indexer search.
 * Generic implementation - not provider-specific.
 */

import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('DirectDownloadFallback');

/**
 * Atomically claim DownloadHistory transition to fallback_triggered and enqueue indexer search.
 *
 * Uses a conditional Prisma update to ensure only one concurrent process wins the claim.
 * Losing duplicate/retry paths leave history untouched and do not enqueue/search/fail.
 *
 * @param requestId - The request ID (ebook or audiobook)
 * @param downloadHistoryId - The DownloadHistory row ID
 * @param errorMessage - Error message to store (e.g., "Zero download URLs available")
 * @param requestType - The request type ('ebook' or 'audiobook')
 */
export async function triggerDirectDownloadFallback(
  requestId: string,
  downloadHistoryId: string,
  errorMessage: string,
  requestType: 'ebook' | 'audiobook'
): Promise<void> {
  logger.info(`Attempting direct download fallback for request ${requestId}, download history ${downloadHistoryId}`);

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

  logger.info(`Fallback claim won for ${downloadHistoryId}, enqueueing indexer search`);

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

  // STEP 5: Enqueue appropriate search job with isFallback=true
  const jobQueue = getJobQueueService();

  if (requestType === 'ebook') {
    // Ebook requests use search_ebook job with isFallback to skip direct download sources
    await jobQueue.addSearchEbookJob(
      requestId,
      {
        id: request.audiobook.id,
        title: request.audiobook.title,
        author: request.audiobook.author,
        asin: request.audiobook.audibleAsin || undefined,
      },
      undefined,
      { isFallback: true } // Flag to skip direct download sources in search
    );

    logger.info(`Enqueued fallback indexer search for ebook request ${requestId}`);
  } else {
    // Audiobook requests use search_indexers job with isFallback flag
    await jobQueue.addSearchJob(
      requestId,
      {
        id: request.audiobook.id,
        title: request.audiobook.title,
        author: request.audiobook.author,
        asin: request.audiobook.audibleAsin ?? undefined,
      }
    );

    // Note: search_indexers doesn't currently have isFallback, but it doesn't need it
    // since audiobooks only use indexer search, not direct download
    logger.info(`Enqueued fallback indexer search for audiobook request ${requestId}`);
  }
}