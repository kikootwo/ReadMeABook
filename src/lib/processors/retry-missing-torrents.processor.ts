/**
 * Component: Retry Missing Torrents Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Retries search for requests that are awaiting torrent search.
 * Also drives bidirectional transitions between `awaiting_search` and
 * `awaiting_release` based on the per-book release date and the
 * `indexer.skip_unreleased` setting.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';
import { getConfigService } from '../services/config.service';
import { shouldSkipAutoSearch } from '../utils/release-date';

export interface RetryMissingTorrentsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processRetryMissingTorrents(payload: RetryMissingTorrentsPayload): Promise<any> {
  const { jobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'RetryMissingTorrents');

  logger.info('Starting retry job for requests awaiting search/release...');

  try {
    // Read skip-unreleased setting once at start (default ON when absent)
    const configService = getConfigService();
    const skipUnreleasedSetting = (await configService.get('indexer.skip_unreleased')) !== 'false';

    // Find all active requests in awaiting_search OR awaiting_release status
    const requests = await prisma.request.findMany({
      where: {
        status: { in: ['awaiting_search', 'awaiting_release'] },
        deletedAt: null,
      },
      include: {
        audiobook: true,
      },
      orderBy: { lastSearchAt: { sort: 'asc', nulls: 'first' } },
      take: 50,
    });
    

    logger.info(`Found ${requests.length} requests awaiting search/release`);

    if (requests.length === 0) {
      return {
        success: true,
        message: 'No requests awaiting search/release',
        triggered: 0,
        transitioned: 0,
        skipped: 0,
      };
    }

    const jobQueue = getJobQueueService();
    let triggered = 0;
    let transitioned = 0;
    let skipped = 0;

    for (const request of requests) {
      try {
        const gate = shouldSkipAutoSearch({ releaseDate: request.releaseDate }, skipUnreleasedSetting);

        if (request.status === 'awaiting_search' && gate.skip) {
          // Future release, setting ON → demote to awaiting_release
          await prisma.request.update({
            where: { id: request.id },
            data: { status: 'awaiting_release' },
          });
          skipped++;
          transitioned++;
          logger.info(`Transitioned request to awaiting_release (unreleased)`, {
            gateSource: 'RetryMissingTorrents',
            requestId: request.id,
            audiobookTitle: request.audiobook.title,
            releaseDate: request.releaseDate?.toISOString() ?? null,
            from: 'awaiting_search',
            to: 'awaiting_release',
          });
        } else if (request.status === 'awaiting_release' && !gate.skip) {
          // Released (or setting OFF) → promote to awaiting_search and run search.
          // Order: update status → queue job → log (race safety).
          await prisma.request.update({
            where: { id: request.id },
            data: { status: 'awaiting_search' },
          });

          if (request.type === 'ebook') {
            await jobQueue.addSearchEbookJob(request.id, {
              id: request.audiobook.id,
              title: request.audiobook.title,
              author: request.audiobook.author,
              asin: request.audiobook.audibleAsin || undefined,
            });
          } else {
            await jobQueue.addSearchJob(request.id, {
              id: request.audiobook.id,
              title: request.audiobook.title,
              author: request.audiobook.author,
              asin: request.audiobook.audibleAsin || undefined,
            });
          }
          triggered++;
          transitioned++;
          logger.info(`Transitioned request to awaiting_search and queued search`, {
            requestId: request.id,
            audiobookTitle: request.audiobook.title,
            releaseDate: request.releaseDate?.toISOString() ?? null,
            from: 'awaiting_release',
            to: 'awaiting_search',
            triggeredBy: 'RetryMissingTorrents',
          });
        } else if (request.status === 'awaiting_release' && gate.skip) {
          // Still unreleased — leave as-is.
          skipped++;
          logger.info(`Skipped awaiting_release request (still unreleased)`, {
            gateSource: 'RetryMissingTorrents',
            requestId: request.id,
            audiobookTitle: request.audiobook.title,
            releaseDate: request.releaseDate?.toISOString() ?? null,
          });
        } else {
          // awaiting_search + !gate.skip → existing search path
          if (request.type === 'ebook') {
            await jobQueue.addSearchEbookJob(request.id, {
              id: request.audiobook.id,
              title: request.audiobook.title,
              author: request.audiobook.author,
              asin: request.audiobook.audibleAsin || undefined,
            });
            triggered++;
            logger.info(`Triggered ebook search for request ${request.id}: ${request.audiobook.title}`);
          } else {
            await jobQueue.addSearchJob(request.id, {
              id: request.audiobook.id,
              title: request.audiobook.title,
              author: request.audiobook.author,
              asin: request.audiobook.audibleAsin || undefined,
            });
            triggered++;
            logger.info(`Triggered audiobook search for request ${request.id}: ${request.audiobook.title}`);
          }
        }
      } catch (error) {
        logger.error(`Failed to process request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Spread DB operations over time to avoid connection pool exhaustion
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info(`Retry pass complete: triggered=${triggered}, transitioned=${transitioned}, skipped=${skipped} of ${requests.length}`);

    return {
      success: true,
      message: 'Retry missing torrents completed',
      totalRequests: requests.length,
      triggered,
      transitioned,
      skipped,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
