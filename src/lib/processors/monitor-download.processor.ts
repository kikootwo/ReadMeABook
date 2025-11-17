/**
 * Component: Monitor Download Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { MonitorDownloadPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getQBittorrentService } from '../integrations/qbittorrent.service';
import { createJobLogger, JobLogger } from '../utils/job-logger';

/**
 * Helper function to retry getTorrent with exponential backoff
 * Handles race condition where torrent isn't immediately available after adding
 */
async function getTorrentWithRetry(
  qbt: any,
  hash: string,
  logger: JobLogger | null,
  maxRetries: number = 3,
  initialDelayMs: number = 500
): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await qbt.getTorrent(hash);
    } catch (error) {
      lastError = error as Error;

      // If this is the last attempt, throw the error
      if (attempt === maxRetries - 1) {
        break;
      }

      // Exponential backoff: 500ms, 1000ms, 2000ms
      const delayMs = initialDelayMs * Math.pow(2, attempt);
      await logger?.warn(`Torrent ${hash} not found, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // All retries failed
  throw lastError || new Error('Failed to get torrent after retries');
}

/**
 * Process monitor download job
 * Checks download progress from download client and updates request status
 * Re-schedules itself if download is still in progress
 */
export async function processMonitorDownload(payload: MonitorDownloadPayload): Promise<any> {
  const { requestId, downloadHistoryId, downloadClientId, downloadClient, jobId } = payload;

  const logger = jobId ? createJobLogger(jobId, 'MonitorDownload') : null;

  try {
    // Get download client service (currently only qBittorrent supported)
    if (downloadClient !== 'qbittorrent') {
      throw new Error(`Download client ${downloadClient} not yet supported`);
    }

    const qbt = await getQBittorrentService();

    // Get torrent status with retry logic (handles race condition)
    const torrent = await getTorrentWithRetry(qbt, downloadClientId, logger);
    const progress = qbt.getDownloadProgress(torrent);

    // Update request progress
    await prisma.request.update({
      where: { id: requestId },
      data: {
        progress: progress.percent,
        updatedAt: new Date(),
      },
    });

    // Update download history
    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: {
        downloadStatus: progress.state,
      },
    });

    // Check download state
    if (progress.state === 'completed') {
      await logger?.info(`Download completed for request ${requestId}`);

      // Get torrent files to find download path
      const files = await qbt.getFiles(downloadClientId);
      const downloadPath = torrent.save_path;

      await logger?.info(`Downloaded to: ${downloadPath}`, {
        filesCount: files.length,
        torrentName: torrent.name,
      });

      // Update download history to completed
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: {
          downloadStatus: 'completed',
          completedAt: new Date(),
        },
      });

      // Get request with audiobook details
      const request = await prisma.request.findUnique({
        where: { id: requestId },
        include: {
          audiobook: true,
        },
      });

      if (!request || !request.audiobook) {
        throw new Error('Request or audiobook not found');
      }

      // Trigger organize files job
      const jobQueue = getJobQueueService();
      await jobQueue.addOrganizeJob(
        requestId,
        request.audiobook.id,
        `${downloadPath}/${torrent.name}`,
        `/media/audiobooks/${request.audiobook.author}/${request.audiobook.title}`
      );

      await logger?.info(`Triggered organize_files job for request ${requestId}`);

      return {
        success: true,
        completed: true,
        message: 'Download completed, organizing files',
        requestId,
        progress: 100,
        downloadPath,
      };
    } else if (progress.state === 'failed') {
      await logger?.error(`Download failed for request ${requestId}`);

      // Update request to failed
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          errorMessage: 'Download failed in qBittorrent',
          updatedAt: new Date(),
        },
      });

      // Update download history
      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: {
          downloadStatus: 'failed',
          downloadError: 'Download failed in qBittorrent',
        },
      });

      return {
        success: false,
        completed: true,
        message: 'Download failed',
        requestId,
        progress: progress.percent,
      };
    } else {
      // Still downloading - schedule another check in 10 seconds
      const jobQueue = getJobQueueService();
      await jobQueue.addMonitorJob(
        requestId,
        downloadHistoryId,
        downloadClientId,
        downloadClient,
        10 // Delay 10 seconds between checks
      );

      // Only log every 5% progress to reduce log spam
      const shouldLog = progress.percent % 5 === 0 || progress.percent < 5;
      if (shouldLog) {
        await logger?.info(`Request ${requestId}: ${progress.percent}% complete (${progress.state})`, {
          speed: progress.speed,
          eta: progress.eta,
        });
      }

      return {
        success: true,
        completed: false,
        message: 'Download in progress, monitoring continues',
        requestId,
        progress: progress.percent,
        speed: progress.speed,
        eta: progress.eta,
        state: progress.state,
      };
    }
  } catch (error) {
    await logger?.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    // Check if this is a transient "torrent not found" error
    const errorMessage = error instanceof Error ? error.message : '';
    const isTorrentNotFound = errorMessage.includes('not found') || errorMessage.includes('Torrent') && errorMessage.includes('not found');

    if (isTorrentNotFound) {
      // Transient error - don't mark request as failed, let Bull retry
      // The request stays in 'downloading' status until Bull exhausts all retries
      await logger?.warn(`Transient error for request ${requestId}, allowing Bull to retry`);
    } else {
      // Permanent error - mark request as failed immediately
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          errorMessage: errorMessage || 'Monitor download failed',
          updatedAt: new Date(),
        },
      });
    }

    // Rethrow to trigger Bull's retry mechanism
    throw error;
  }
}
