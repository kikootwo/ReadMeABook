/**
 * Component: Monitor Download Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { MonitorDownloadPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { PathMapper, PathMappingConfig } from '../utils/path-mapper';
import { getConfigService } from '../services/config.service';
import { getDownloadClientManager } from '../services/download-client-manager.service';
import { CLIENT_PROTOCOL_MAP, DownloadClientType } from '../interfaces/download-client.interface';

/**
 * Process monitor download job
 * Checks download progress from download client and updates request status
 * Re-schedules itself if download is still in progress
 */
/** Base polling interval in seconds */
const BASE_POLL_INTERVAL = 10;
/** Maximum polling interval in seconds (5 minutes) */
const MAX_POLL_INTERVAL = 300;

/**
 * Compute next poll delay with exponential backoff for stalled downloads.
 * Active downloads poll every 10s; stalled downloads back off up to 5 min.
 */
function getBackoffDelay(stallCount: number): number {
  if (stallCount <= 0) return BASE_POLL_INTERVAL;
  return Math.min(BASE_POLL_INTERVAL * Math.pow(2, stallCount), MAX_POLL_INTERVAL);
}

export async function processMonitorDownload(payload: MonitorDownloadPayload): Promise<any> {
  const { requestId, downloadHistoryId, downloadClientId, downloadClient, jobId,
          lastProgress: prevProgress, stallCount: prevStallCount } = payload;

  const logger = RMABLogger.forJob(jobId, 'MonitorDownload');

  try {
    // Get the download client service via the manager
    const configService = getConfigService();
    const manager = getDownloadClientManager(configService);
    const protocol = CLIENT_PROTOCOL_MAP[downloadClient as DownloadClientType];
    if (!protocol) {
      throw new Error(`Unknown download client type: ${downloadClient}`);
    }
    const client = await manager.getClientServiceForProtocol(protocol);

    if (!client) {
      throw new Error(`No ${downloadClient} client configured`);
    }

    // Get download status via unified interface
    const info = await client.getDownload(downloadClientId);

    if (!info) {
      throw new Error(`Download ${downloadClientId} not found in ${downloadClient}`);
    }

    // Build progress object for request updates
    const progressPercent = Math.round(info.progress * 100);
    const progressState = info.status;

    if (client.protocol === 'usenet') {
      logger.info(`${client.clientType} status: ${info.status}`, {
        progress: `${(info.progress * 100).toFixed(1)}%`,
        speed: `${(info.downloadSpeed / 1024 / 1024).toFixed(2)} MB/s`,
      });
    }

    // Update request progress
    await prisma.request.update({
      where: { id: requestId },
      data: {
        progress: progressPercent,
        updatedAt: new Date(),
      },
    });

    // Update download history
    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: {
        downloadStatus: progressState,
      },
    });

    // Check download state
    if (progressState === 'completed' || progressState === 'seeding') {
      logger.info(`Download completed for request ${requestId}`);

      // Ensure we have a download path
      const downloadPath = info.downloadPath;
      if (!downloadPath) {
        throw new Error('Download path not available from download client');
      }

      // Get path mapping configuration from the specific download client
      const clientConfig = await manager.getClientForProtocol(protocol);

      // Build path mapping config from client settings
      const pathMappingConfig: PathMappingConfig = clientConfig && clientConfig.remotePathMappingEnabled
        ? {
            enabled: true,
            remotePath: clientConfig.remotePath || '',
            localPath: clientConfig.localPath || '',
          }
        : { enabled: false, remotePath: '', localPath: '' };

      // Apply remote-to-local path transformation if enabled
      const organizePath = PathMapper.transform(downloadPath, pathMappingConfig);

      logger.info(`Download completed`, {
        downloadClient: client.clientType,
        downloadPath,
        organizePath: organizePath !== downloadPath ? `${organizePath} (mapped)` : organizePath,
      });

      // Update download history to completed (store mapped path for retry reliability)
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: {
          downloadStatus: 'completed',
          completedAt: new Date(),
          downloadPath: organizePath,
        },
      });

      // Get request with audiobook details
      const request = await prisma.request.findFirst({
        where: {
          id: requestId,
          deletedAt: null,
        },
        include: {
          audiobook: true,
        },
      });

      if (!request || !request.audiobook) {
        throw new Error('Request or audiobook not found or deleted');
      }

      // Trigger organize files job with properly constructed path
      const jobQueue = getJobQueueService();
      await jobQueue.addOrganizeJob(
        requestId,
        request.audiobook.id,
        organizePath
      );

      logger.info(`Triggered organize_files job for request ${requestId}`);

      return {
        success: true,
        completed: true,
        message: 'Download completed, organizing files',
        requestId,
        progress: 100,
        downloadPath: organizePath,
      };
    } else if (progressState === 'failed') {
      logger.error(`Download failed for request ${requestId}`);

      const errorMessage = `Download failed in ${client.clientType}`;

      // Update request to failed
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          errorMessage,
          updatedAt: new Date(),
        },
      });

      // Update download history
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: {
          downloadStatus: 'failed',
          downloadError: errorMessage,
        },
      });

      // Send notification for request failure
      const request = await prisma.request.findUnique({
        where: { id: requestId },
        include: {
          audiobook: true,
          user: { select: { plexUsername: true } },
        },
      });

      if (request) {
        const jobQueue = getJobQueueService();
        await jobQueue.addNotificationJob(
          'request_error',
          request.id,
          request.audiobook.title,
          request.audiobook.author,
          request.user.plexUsername || 'Unknown User',
          errorMessage
        ).catch((error) => {
          logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
        });
      }

      return {
        success: false,
        completed: true,
        message: 'Download failed',
        requestId,
        progress: progressPercent,
      };
    } else {
      // Still downloading — compute adaptive poll interval
      const isStalled = info.downloadSpeed === 0
        || progressPercent === (prevProgress ?? -1)
        || progressState === 'paused'
        || progressState === 'queued'
        || progressState === 'checking';

      const stallCount = isStalled ? (prevStallCount ?? 0) + 1 : 0;
      const delay = getBackoffDelay(stallCount);

      const jobQueue = getJobQueueService();
      await jobQueue.addMonitorJob(
        requestId,
        downloadHistoryId,
        downloadClientId,
        downloadClient,
        delay,
        progressPercent,
        stallCount
      );

      // Only log every 5% progress to reduce log spam, but always log stall transitions
      const shouldLog = progressPercent % 5 === 0 || progressPercent < 5
        || (stallCount === 1) || (stallCount > 0 && stallCount % 10 === 0);
      if (shouldLog) {
        logger.info(`Request ${requestId}: ${progressPercent}% complete (${progressState})`, {
          speed: info.downloadSpeed,
          eta: info.eta,
          ...(stallCount > 0 && { stallCount, nextPollSec: delay }),
        });
      }

      return {
        success: true,
        completed: false,
        message: 'Download in progress, monitoring continues',
        requestId,
        progress: progressPercent,
        speed: info.downloadSpeed,
        eta: info.eta,
        state: progressState,
        stallCount,
        nextPollSec: delay,
      };
    }
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    // Check if this is a transient "not found" error
    const errorMessage = error instanceof Error ? error.message : '';
    const isNotFound = errorMessage.includes('not found');

    if (isNotFound) {
      // Transient error - don't mark request as failed, let Bull retry
      // The request stays in 'downloading' status until Bull exhausts all retries
      logger.warn(`Transient error for request ${requestId}, allowing Bull to retry`);
    } else {
      // Permanent error - mark request as failed immediately
      const failureMessage = errorMessage || 'Monitor download failed';
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          errorMessage: failureMessage,
          updatedAt: new Date(),
        },
      });

      // Send notification for request failure
      const request = await prisma.request.findUnique({
        where: { id: requestId },
        include: {
          audiobook: true,
          user: { select: { plexUsername: true } },
        },
      });

      if (request) {
        const jobQueue = getJobQueueService();
        await jobQueue.addNotificationJob(
          'request_error',
          request.id,
          request.audiobook.title,
          request.audiobook.author,
          request.user.plexUsername || 'Unknown User',
          failureMessage
        ).catch((error) => {
          logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
        });
      }
    }

    // Rethrow to trigger Bull's retry mechanism
    throw error;
  }
}
