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
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'downloading',
        progress: 0,
        updatedAt: new Date(),
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

    // Add download via unified interface
    const downloadClientId = await client.addDownload(torrent.downloadUrl, {
      category,
      priority: 'normal',
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

    // Trigger monitor download job with initial delay
    const jobQueue = getJobQueueService();
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
      // Permanent error — mark request as failed immediately
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Failed to add download to client',
          updatedAt: new Date(),
        },
      });
    }

    throw error;
  }
}
