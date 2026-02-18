/**
 * Component: Monitor RSS Feeds Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Monitors RSS feeds for new releases and matches against missing requests (audiobooks and ebooks)
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';

export interface MonitorRssFeedsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processMonitorRssFeeds(payload: MonitorRssFeedsPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'MonitorRssFeeds');

  logger.info(`Starting RSS feed monitoring...`);

  // Get indexer configuration
  const { getConfigService } = await import('../services/config.service');
  const configService = getConfigService();
  const indexersConfigStr = await configService.get('prowlarr_indexers');

  if (!indexersConfigStr) {
    logger.warn(`No indexers configured, skipping`);
    return { success: false, message: 'No indexers configured', skipped: true };
  }

  const indexersConfig = JSON.parse(indexersConfigStr);

  // Filter indexers that have RSS enabled
  const rssEnabledIndexers = indexersConfig.filter(
    (indexer: any) => indexer.rssEnabled === true
  );

  if (rssEnabledIndexers.length === 0) {
    logger.warn(`No indexers with RSS enabled, skipping`);
    return { success: false, message: 'No RSS-enabled indexers', skipped: true };
  }

  logger.info(`Monitoring ${rssEnabledIndexers.length} RSS-enabled indexers`);

  // Get RSS feeds from all enabled indexers
  const { getProwlarrService } = await import('../integrations/prowlarr.service');
  const prowlarrService = await getProwlarrService();

  const indexerIds = rssEnabledIndexers.map((i: any) => i.id);
  const rssResults = await prowlarrService.getAllRssFeeds(indexerIds);

  logger.info(`Retrieved ${rssResults.length} items from RSS feeds`);

  if (rssResults.length === 0) {
    return { success: true, message: 'No RSS results', matched: 0 };
  }

  // Get all active requests awaiting search (audiobooks and ebooks)
  // Both types can be matched against RSS torrent feeds
  const missingRequests = await prisma.request.findMany({
    where: {
      status: 'awaiting_search',
      deletedAt: null,
    },
    include: { audiobook: true },
    take: 100,
  });

  logger.info(`Found ${missingRequests.length} requests awaiting search`);

  if (missingRequests.length === 0) {
    return { success: true, message: 'No missing requests', matched: 0 };
  }

  // Match RSS results against missing requests
  let matched = 0;
  const jobQueue = getJobQueueService();

  for (const request of missingRequests) {
    const audiobook = request.audiobook;

    // Simple fuzzy matching: check if torrent title contains author and partial title
    const authorWords = audiobook.author.toLowerCase().split(' ');
    const titleWords = audiobook.title.toLowerCase().split(' ').slice(0, 3);

    for (const torrent of rssResults) {
      const torrentTitle = torrent.title.toLowerCase();

      // Check if torrent contains author name and at least 2 title words
      const hasAuthor = authorWords.some(word => word.length > 2 && torrentTitle.includes(word));
      const titleMatchCount = titleWords.filter(word => word.length > 2 && torrentTitle.includes(word)).length;

      if (hasAuthor && titleMatchCount >= 2) {
        logger.info(`Match found! "${audiobook.title}" by ${audiobook.author} matches torrent: ${torrent.title}`);

        // Trigger appropriate search job based on request type
        try {
          if (request.type === 'ebook') {
            await jobQueue.addSearchEbookJob(request.id, {
              id: audiobook.id,
              title: audiobook.title,
              author: audiobook.author,
              asin: audiobook.audibleAsin || undefined,
            });
            matched++;
            logger.info(`Triggered ebook search job for request ${request.id}`);
          } else {
            await jobQueue.addSearchJob(request.id, {
              id: audiobook.id,
              title: audiobook.title,
              author: audiobook.author,
              asin: audiobook.audibleAsin || undefined,
            });
            matched++;
            logger.info(`Triggered audiobook search job for request ${request.id}`);
          }
        } catch (error) {
          logger.error(`Failed to trigger search for request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // Only trigger once per request
        break;
      }
    }

    // Spread DB operations over time to avoid connection pool exhaustion
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  logger.info(`RSS monitoring complete: ${matched} matches found and queued for processing`);

  return {
    success: true,
    message: 'RSS monitoring completed',
    matched,
    totalFeeds: rssResults.length,
    totalMissing: missingRequests.length,
  };
}
