/**
 * Component: Retry Failed Imports Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Retries file organization for requests that are awaiting import
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';
import { getConfigService } from '../services/config.service';
import { getDownloadClientManager } from '../services/download-client-manager.service';
import { PathMapper, PathMappingConfig } from '../utils/path-mapper';

export interface RetryFailedImportsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processRetryFailedImports(payload: RetryFailedImportsPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'RetryFailedImports');

  logger.info('Starting retry job for requests awaiting import...');

  try {
    // Initialize config and download client manager
    const configService = getConfigService();
    const manager = getDownloadClientManager(configService);

    // Helper function to get path mapping config for a specific download client type
    const getPathMappingForClient = async (clientType: string): Promise<PathMappingConfig> => {
      const protocol = clientType === 'sabnzbd' ? 'usenet' : 'torrent';
      const clientConfig = await manager.getClientForProtocol(protocol);

      if (clientConfig && clientConfig.remotePathMappingEnabled) {
        return {
          enabled: true,
          remotePath: clientConfig.remotePath || '',
          localPath: clientConfig.localPath || '',
        };
      }
      return { enabled: false, remotePath: '', localPath: '' };
    };

    // Find all active audiobook requests in awaiting_import status
    // Note: Ebook requests use the same organize_files processor but with type branching
    const requests = await prisma.request.findMany({
      where: {
        type: 'audiobook', // Only audiobook requests (ebooks handled by same processor but different flow)
        status: 'awaiting_import',
        deletedAt: null,
      },
      include: {
        audiobook: true,
        downloadHistory: {
          where: { selected: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      take: 50, // Limit to 50 requests per run
    });

    logger.info(`Found ${requests.length} requests awaiting import`);

    if (requests.length === 0) {
      return {
        success: true,
        message: 'No requests awaiting import',
        triggered: 0,
      };
    }

    // Trigger organize job for each request
    const jobQueue = getJobQueueService();
    let triggered = 0;
    let skipped = 0;

    for (const request of requests) {
      try {
        // Get the download path from the most recent download history
        const downloadHistory = request.downloadHistory[0];

        if (!downloadHistory) {
          logger.warn(`No download history found for request ${request.id}, skipping`);
          skipped++;
          continue;
        }

        let downloadPath: string;

        // Try to get download path from the appropriate download client
        // Get path mapping for this specific download client
        const clientType = downloadHistory.downloadClient || 'qbittorrent';
        const mappingConfig = await getPathMappingForClient(clientType);

        if (downloadHistory.torrentHash) {
          // qBittorrent download
          try {
            const { getQBittorrentService } = await import('../integrations/qbittorrent.service');
            const qbt = await getQBittorrentService();
            const torrent = await qbt.getTorrent(downloadHistory.torrentHash);
            const qbPath = `${torrent.save_path}/${torrent.name}`;
            downloadPath = PathMapper.transform(qbPath, mappingConfig);
            logger.info(
              `Got download path from qBittorrent for request ${request.id}: ${qbPath}` +
              (downloadPath !== qbPath ? ` → ${downloadPath} (mapped)` : '')
            );
          } catch (qbtError) {
            // Torrent not found in qBittorrent - try to construct path from config
            logger.warn(`Torrent not found in qBittorrent for request ${request.id}, falling back to configured path`);

            if (!downloadHistory.torrentName) {
              logger.warn(`No torrent name stored for request ${request.id}, cannot construct fallback path, skipping`);
              skipped++;
              continue;
            }

            const downloadDir = await configService.get('download_dir');

            if (!downloadDir) {
              logger.error(`download_dir not configured, cannot retry request ${request.id}, skipping`);
              skipped++;
              continue;
            }

            const fallbackPath = `${downloadDir}/${downloadHistory.torrentName}`;
            downloadPath = PathMapper.transform(fallbackPath, mappingConfig);
            logger.info(
              `Using fallback download path for request ${request.id}: ${fallbackPath}` +
              (downloadPath !== fallbackPath ? ` → ${downloadPath} (mapped)` : '')
            );
          }
        } else if (downloadHistory.nzbId) {
          // SABnzbd download
          try {
            const { getSABnzbdService } = await import('../integrations/sabnzbd.service');
            const sabnzbd = await getSABnzbdService();
            const nzbInfo = await sabnzbd.getNZB(downloadHistory.nzbId);
            if (nzbInfo && nzbInfo.downloadPath) {
              downloadPath = PathMapper.transform(nzbInfo.downloadPath, mappingConfig);
              logger.info(
                `Got download path from SABnzbd for request ${request.id}: ${nzbInfo.downloadPath}` +
                (downloadPath !== nzbInfo.downloadPath ? ` → ${downloadPath} (mapped)` : '')
              );
            } else {
              logger.warn(`NZB ${downloadHistory.nzbId} not found or has no download path for request ${request.id}, falling back to configured path`);

              if (!downloadHistory.torrentName) {
                logger.warn(`No name stored for request ${request.id}, cannot construct fallback path, skipping`);
                skipped++;
                continue;
              }

              const downloadDir = await configService.get('download_dir');

              if (!downloadDir) {
                logger.error(`download_dir not configured, cannot retry request ${request.id}, skipping`);
                skipped++;
                continue;
              }

              const fallbackPath = `${downloadDir}/${downloadHistory.torrentName}`;
              downloadPath = PathMapper.transform(fallbackPath, mappingConfig);
              logger.info(
                `Using fallback download path for request ${request.id}: ${fallbackPath}` +
                (downloadPath !== fallbackPath ? ` → ${downloadPath} (mapped)` : '')
              );
            }
          } catch (sabnzbdError) {
            logger.warn(`SABnzbd error for request ${request.id}: ${sabnzbdError instanceof Error ? sabnzbdError.message : 'Unknown error'}, skipping`);
            skipped++;
            continue;
          }
        } else {
          // No download client ID - use fallback path
          if (!downloadHistory.torrentName) {
            logger.warn(`No download client ID or name for request ${request.id}, skipping`);
            skipped++;
            continue;
          }

          const downloadDir = await configService.get('download_dir');

          if (!downloadDir) {
            logger.error(`download_dir not configured, cannot retry request ${request.id}, skipping`);
            skipped++;
            continue;
          }

          const configuredPath = `${downloadDir}/${downloadHistory.torrentName}`;
          downloadPath = PathMapper.transform(configuredPath, mappingConfig);
          logger.info(
            `Using configured download path for request ${request.id}: ${configuredPath}` +
            (downloadPath !== configuredPath ? ` → ${downloadPath} (mapped)` : '')
          );
        }

        await jobQueue.addOrganizeJob(
          request.id,
          request.audiobook.id,
          downloadPath
        );
        triggered++;
        logger.info(`Triggered organize job for request ${request.id}: ${request.audiobook.title}`);
      } catch (error) {
        logger.error(`Failed to trigger organize for request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        skipped++;
      }
    }

    logger.info(`Triggered ${triggered}/${requests.length} organize jobs (${skipped} skipped)`);

    return {
      success: true,
      message: 'Retry failed imports completed',
      totalRequests: requests.length,
      triggered,
      skipped,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
