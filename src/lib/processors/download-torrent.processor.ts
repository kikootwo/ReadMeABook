/**
 * Component: Download Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { DownloadTorrentPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getConfigService } from '../services/config.service';
import { getDownloadClientManager } from '../services/download-client-manager.service';
import { ProwlarrService } from '../integrations/prowlarr.service';
import { RMABLogger } from '../utils/logger';
import { isTransientConnectionError } from '../utils/connection-errors';
import { addAutoBlock, type BlockSource } from '../services/blocklist.service';

/**
 * Process download job
 * Routes to appropriate download client based on protocol detection
 * Adds selected result to download client and starts monitoring
 */
export async function processDownloadTorrent(payload: DownloadTorrentPayload): Promise<any> {
  const { requestId, audiobook, torrent, jobId } = payload;

  const logger = RMABLogger.forJob(jobId, 'DownloadTorrent');

  logger.info(`Processing request ${requestId} for "${audiobook.title}"`);
  logger.info(`Selected result: ${torrent.title}`, {
    size: torrent.size,
    seeders: torrent.seeders,
    format: torrent.format,
    indexer: torrent.indexer,
  });

  try {
    // Update request status to downloading
    const request = await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'downloading',
        progress: 0,
        updatedAt: new Date(),
      },
      include: {
        user: { select: { plexUsername: true } },
      },
    });

    // Detect protocol from result and get appropriate client
    const isUsenet = ProwlarrService.isNZBResult(torrent);
    const protocol = isUsenet ? 'usenet' : 'torrent';
    const config = await getConfigService();
    const manager = getDownloadClientManager(config);

    const client = await manager.getClientServiceForProtocol(protocol);

    if (!client) {
      throw new Error(`No ${protocol} download client configured. Please add a ${protocol} client in Settings > Download Clients.`);
    }

    // Get client config for category
    const clientConfig = await manager.getClientForProtocol(protocol);
    const category = clientConfig?.category || 'readmeabook';

    logger.info(`Routing to ${client.clientType} (${client.protocol})`);

    // Include Prowlarr API key as source header so NZB/torrent downloads from
    // Prowlarr proxy URLs are authenticated (fixes 403 for indexers like NZBFinder)
    const prowlarrApiKey = (await config.getMany(['prowlarr_api_key'])).prowlarr_api_key || process.env.PROWLARR_API_KEY;
    const sourceHeaders: Record<string, string> = {};
    if (prowlarrApiKey) {
      sourceHeaders['X-Api-Key'] = prowlarrApiKey;
    }

    // Add download via unified interface
    const downloadClientId = await client.addDownload(torrent.downloadUrl, {
      category,
      priority: 'normal',
      sourceHeaders,
    });

    logger.info(`Download added with ID: ${downloadClientId}`);

    // Create DownloadHistory record
    // Determine indexer page URL - exclude magnet links from guid fallback
    const indexerPageUrl = torrent.infoUrl || (torrent.guid?.startsWith('magnet:') ? null : torrent.guid);

    const downloadHistory = await prisma.downloadHistory.create({
      data: {
        requestId,
        indexerName: torrent.indexer,
        indexerId: torrent.indexerId,
        downloadClient: client.clientType,
        downloadClientId,
        torrentName: torrent.title,
        // Set protocol-specific ID fields for backward compatibility
        torrentHash: client.protocol === 'torrent' ? (torrent.infoHash || downloadClientId) : undefined,
        nzbId: client.protocol === 'usenet' ? downloadClientId : undefined,
        torrentSizeBytes: torrent.size,
        torrentUrl: indexerPageUrl,
        magnetLink: torrent.downloadUrl,
        seeders: torrent.seeders || 0,
        leechers: torrent.leechers || 0,
        downloadStatus: 'downloading',
        selected: true,
        startedAt: new Date(),
      },
    });

    logger.info(`Created download history record: ${downloadHistory.id}`);

    // Send grab notification (non-blocking — failures here don't fail the download)
    const jobQueue = getJobQueueService();
    const grabMessage = `${torrent.title} via ${torrent.indexer} (${client.clientType})`;
    await jobQueue.addNotificationJob(
      'request_grabbed',
      requestId,
      audiobook.title,
      audiobook.author,
      request.user.plexUsername || 'Unknown User',
      grabMessage,
      request.type
    ).catch((error) => {
      logger.error('Failed to queue grab notification', { error: error instanceof Error ? error.message : String(error) });
    });

    // Trigger monitor download job with initial delay
    await jobQueue.addMonitorJob(
      requestId,
      downloadHistory.id,
      downloadClientId,
      client.clientType,
      3 // Wait 3 seconds before first check
    );

    logger.info(`Started monitoring job for request ${requestId} (${client.clientType}, 3s initial delay)`);

    return {
      success: true,
      message: `Download added to ${client.clientType} and monitoring started`,
      requestId,
      downloadHistoryId: downloadHistory.id,
      downloadClientId,
      torrent: {
        title: torrent.title,
        size: torrent.size,
        seeders: torrent.seeders || 0,
        format: torrent.format,
      },
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    if (isTransientConnectionError(error)) {
      // Connection error — don't mark request as failed yet.
      // Bull will retry this job (3 attempts with exponential backoff).
      // If all retries are exhausted, the global failed handler marks it failed.
      logger.warn(`Download client unreachable for request ${requestId}, allowing Bull to retry`);
    } else {
      // Permanent error — blocklist this release and trigger ranked-hierarchy continuation
      // for ALL request types (ebook and audiobook)
      const requestDetails = await prisma.request.findUnique({
        where: { id: requestId },
        select: { type: true },
      });

      const requestType = requestDetails?.type || 'audiobook';
      const jobQueue = getJobQueueService();

      // Blocklist the failed release
      await addAutoBlock({
        requestId,
        releaseName: torrent.title,
        releaseHash: torrent.infoHash || undefined,
        indexerName: torrent.indexer,
        indexerId: torrent.indexerId,
        source: 'download_fail',
        reason: `Download client add failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        reasonDetail: error instanceof Error ? error.message : undefined,
        jobId,
      });

      // Update request status to allow continuation search
      // NOTE: Do NOT increment searchAttempts - search processors already do this
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'awaiting_search',
          errorMessage: `Failed to add ${torrent.title} to download client, trying next candidate`,
          updatedAt: new Date(),
        },
      });

      // Re-queue search job with fallback semantics for ranked-hierarchy continuation
      if (requestType === 'ebook') {
        // Ebook: use search_ebook with isFallback=true to skip direct download sources
        await jobQueue.addSearchEbookJob(
          requestId,
          audiobook,
          torrent.format,
          { isFallback: true } // Skip direct download sources, continue through ranked candidates
        );
        logger.info(`Blocklisted ${torrent.title} and re-queued ebook search for next candidate (isFallback: true)`);
      } else {
        // Audiobook: use search_indexers for ranked-hierarchy continuation
        await jobQueue.addSearchJob(
          requestId,
          audiobook
        );
        logger.info(`Blocklisted ${torrent.title} and re-queued audiobook search for next candidate`);
      }

      // Don't throw - we've handled the error by triggering continuation
      return {
        success: false,
        message: `Download failed, trying next candidate`,
        requestId,
        blockedRelease: torrent.title,
        continuationTriggered: true,
      };
    }

    throw error;
  }
}
