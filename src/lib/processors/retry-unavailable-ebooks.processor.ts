/**
 * Component: Retry Unavailable Ebooks Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Weekly re-search of ebook requests that settled in `unavailable` after
 * exhausting the search threshold. Resets them to `awaiting_search` and
 * enqueues a fresh search — if found, the normal download flow takes over;
 * if still missing, search-ebook flips them back to `unavailable`.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';

export interface RetryUnavailableEbooksPayload {
  jobId?: string;
  scheduledJobId?: string;
}

const PER_RUN_LIMIT = 50;

export async function processRetryUnavailableEbooks(payload: RetryUnavailableEbooksPayload): Promise<any> {
  const { jobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'RetryUnavailableEbooks');

  logger.info('Starting weekly retry for unavailable ebook requests...');

  try {
    const requests = await prisma.request.findMany({
      where: {
        status: 'unavailable',
        type: 'ebook',
        deletedAt: null,
      },
      include: {
        audiobook: true,
      },
      take: PER_RUN_LIMIT,
    });

    logger.info(`Found ${requests.length} unavailable ebook requests`);

    if (requests.length === 0) {
      return {
        success: true,
        message: 'No unavailable ebook requests to retry',
        triggered: 0,
      };
    }

    const jobQueue = getJobQueueService();
    let triggered = 0;

    for (const request of requests) {
      try {
        // Reset searchAttempts so the search-ebook processor gives a fresh
        // threshold window before re-settling as unavailable.
        await prisma.request.update({
          where: { id: request.id },
          data: {
            status: 'awaiting_search',
            searchAttempts: 0,
            errorMessage: null,
            updatedAt: new Date(),
          },
        });

        await jobQueue.addSearchEbookJob(request.id, {
          id: request.audiobook.id,
          title: request.audiobook.title,
          author: request.audiobook.author,
          asin: request.audiobook.audibleAsin || undefined,
        });

        triggered++;
        logger.info(`Re-queued unavailable ebook: ${request.audiobook.title}`, {
          requestId: request.id,
        });
      } catch (error) {
        logger.error(`Failed to retry request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info(`Retry pass complete: triggered=${triggered} of ${requests.length}`);

    return {
      success: true,
      message: 'Retry unavailable ebooks completed',
      totalRequests: requests.length,
      triggered,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
