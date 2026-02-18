/**
 * Component: Retry Failed Imports Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Retries file organization for requests that are awaiting import.
 * Uses the IDownloadClient interface for client-agnostic path resolution.
 */

import path from 'path';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';
import { getConfigService } from '../services/config.service';
import { getDownloadClientManager, DownloadClientManager } from '../services/download-client-manager.service';
import { PathMapper, PathMappingConfig } from '../utils/path-mapper';
import { CLIENT_PROTOCOL_MAP, DownloadClientType, ProtocolType } from '../interfaces/download-client.interface';

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
      const protocol = CLIENT_PROTOCOL_MAP[clientType as DownloadClientType] || 'torrent';
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

    // Find all requests in awaiting_import status (both audiobook and ebook)
    // The organize_files processor handles both types with type-based branching
    const requests = await prisma.request.findMany({
      where: {
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

        // Get path mapping for this specific download client
        const clientType = downloadHistory.downloadClient || 'qbittorrent';

        // Direct downloads (e.g. Anna's Archive ebooks) have no external download client
        // Use stored path or construct from download_dir directly
        if (clientType === 'direct') {
          const noMapping: PathMappingConfig = { enabled: false, remotePath: '', localPath: '' };
          downloadPath = getStoredPath(downloadHistory, request.id, logger) || await getFallbackPath(downloadHistory, configService, noMapping, request.id, logger);
        } else {
          // Real download client — resolve path via client API with path mapping
          const mappingConfig = await getPathMappingForClient(clientType);
          const clientId = downloadHistory.downloadClientId || downloadHistory.torrentHash || downloadHistory.nzbId;

          const protocol = CLIENT_PROTOCOL_MAP[clientType as DownloadClientType] as ProtocolType | undefined;
          if (!protocol) {
            logger.warn(`Unknown download client type: ${clientType} for request ${request.id}, skipping`);
            skipped++;
            continue;
          }

          if (clientId) {
            // Try to get path from download client via unified interface
            const client = await manager.getClientServiceForProtocol(protocol);

            if (client) {
              try {
                const info = await client.getDownload(clientId);
                if (info?.downloadPath) {
                  downloadPath = PathMapper.transform(info.downloadPath, mappingConfig);
                  logger.info(
                    `Got download path from ${client.clientType} for request ${request.id}: ${info.downloadPath}` +
                    (downloadPath !== info.downloadPath ? ` → ${downloadPath} (mapped)` : '')
                  );
                } else {
                  // Download found but no path — try stored path, then fallback
                  downloadPath = getStoredPath(downloadHistory, request.id, logger) || await getFallbackPath(downloadHistory, configService, mappingConfig, request.id, logger, manager, protocol);
                }
              } catch (clientError) {
                // Client error — try stored path, then fallback
                logger.warn(`${client.clientType} error for request ${request.id}: ${clientError instanceof Error ? clientError.message : 'Unknown error'}, using fallback path`);
                downloadPath = getStoredPath(downloadHistory, request.id, logger) || await getFallbackPath(downloadHistory, configService, mappingConfig, request.id, logger, manager, protocol);
              }
            } else {
              // No client configured — try stored path, then fallback
              downloadPath = getStoredPath(downloadHistory, request.id, logger) || await getFallbackPath(downloadHistory, configService, mappingConfig, request.id, logger, manager, protocol);
            }
          } else {
            // No client ID — try stored path, then fallback
            downloadPath = getStoredPath(downloadHistory, request.id, logger) || await getFallbackPath(downloadHistory, configService, mappingConfig, request.id, logger, manager, protocol);
          }
        }

        // Check if we got a valid path (getFallbackPath returns empty string on failure)
        if (!downloadPath) {
          skipped++;
          continue;
        }

        await jobQueue.addOrganizeJob(
          request.id,
          request.audiobook.id,
          downloadPath
        );
        triggered++;
        logger.info(`Triggered organize job for ${request.type || 'audiobook'} request ${request.id}: ${request.audiobook.title}`);

        // Spread DB operations over time to avoid connection pool exhaustion
        await new Promise(resolve => setTimeout(resolve, 100));
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

/**
 * Return the stored download path from the database (saved at download completion time).
 * Returns empty string if not available (old records won't have this field).
 */
function getStoredPath(
  downloadHistory: { downloadPath?: string | null },
  requestId: string,
  logger: RMABLogger
): string {
  if (downloadHistory.downloadPath) {
    logger.info(`Using stored download path for request ${requestId}: ${downloadHistory.downloadPath}`);
    return downloadHistory.downloadPath;
  }
  return '';
}

/**
 * Construct a fallback download path from config when the download client can't provide one.
 * Returns empty string if path cannot be determined (caller should skip the request).
 */
async function getFallbackPath(
  downloadHistory: { torrentName: string | null },
  configService: any,
  mappingConfig: PathMappingConfig,
  requestId: string,
  logger: RMABLogger,
  manager?: DownloadClientManager,
  protocol?: ProtocolType
): Promise<string> {
  if (!downloadHistory.torrentName) {
    logger.warn(`No download name stored for request ${requestId}, cannot construct fallback path, skipping`);
    return '';
  }

  const baseDir = await configService.get('download_dir');

  if (!baseDir) {
    logger.error(`download_dir not configured, cannot retry request ${requestId}, skipping`);
    return '';
  }

  // Resolve customPath from the client config if available
  let downloadDir = baseDir;
  if (manager && protocol) {
    const clientConfig = await manager.getClientForProtocol(protocol);
    if (clientConfig?.customPath) {
      downloadDir = path.join(baseDir, clientConfig.customPath);
    }
  }

  const fallbackPath = `${downloadDir}/${downloadHistory.torrentName}`;
  const mappedPath = PathMapper.transform(fallbackPath, mappingConfig);
  logger.info(
    `Using fallback download path for request ${requestId}: ${fallbackPath}` +
    (mappedPath !== fallbackPath ? ` → ${mappedPath} (mapped)` : '')
  );
  return mappedPath;
}
