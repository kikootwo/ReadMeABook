/**
 * Component: Direct Download Job Processors
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Handles direct HTTP downloads for ebooks from Anna's Archive.
 * Reports progress similar to qBittorrent/SABnzbd for unified UI.
 */

import { StartDirectDownloadPayload, MonitorDirectDownloadPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getConfigService } from '../services/config.service';
import { RMABLogger } from '../utils/logger';
import { extractDownloadUrl, ExtractedDownload } from '../services/ebook-scraper';
import axios from 'axios';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';

const DOWNLOAD_TIMEOUT_MS = 120000; // 2 minutes per download attempt
const MAX_DOWNLOAD_ATTEMPTS = 5;
const PROGRESS_UPDATE_INTERVAL_MS = 2000; // Update progress every 2 seconds

// In-memory tracking for active downloads
interface ActiveDownload {
  id: string;
  requestId: string;
  downloadHistoryId: string;
  targetPath: string;
  bytesDownloaded: number;
  bytesTotal: number;
  startTime: number;
  lastUpdateTime: number;
  completed: boolean;
  failed: boolean;
  error?: string;
}

const activeDownloads = new Map<string, ActiveDownload>();

/**
 * Generate unique download ID
 */
function generateDownloadId(): string {
  return `dl_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Process start direct download job
 * Initiates the HTTP download and schedules monitoring
 */
export async function processStartDirectDownload(payload: StartDirectDownloadPayload): Promise<any> {
  const { requestId, downloadHistoryId, downloadUrl, targetFilename, expectedSize, jobId } = payload;

  const logger = RMABLogger.forJob(jobId, 'DirectDownload');

  logger.info(`Starting direct download for request ${requestId}`);

  try {
    // Update request status to downloading
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'downloading',
        progress: 0,
        downloadAttempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    // Update download history
    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: {
        downloadStatus: 'downloading',
        startedAt: new Date(),
      },
    });

    // Get download configuration
    const configService = getConfigService();
    const downloadsDir = await configService.get('download_dir') || '/downloads';
    const baseUrl = await configService.get('ebook_sidecar_base_url') || 'https://annas-archive.li';
    const preferredFormat = await configService.get('ebook_sidecar_preferred_format') || 'epub';
    const flaresolverrUrl = await configService.get('ebook_sidecar_flaresolverr_url') || undefined;

    // Get all download URLs from download history (stored as JSON in torrentUrl)
    const downloadHistory = await prisma.downloadHistory.findUnique({
      where: { id: downloadHistoryId },
    });

    let downloadUrls: string[] = [];
    try {
      downloadUrls = downloadHistory?.torrentUrl ? JSON.parse(downloadHistory.torrentUrl) : [downloadUrl];
    } catch {
      downloadUrls = [downloadUrl];
    }

    logger.info(`Have ${downloadUrls.length} download URL(s) to try`);

    // Try each slow download URL until one succeeds
    let downloadResult: { success: boolean; filePath?: string; format?: string; error?: string } = {
      success: false,
      error: 'No download URLs available',
    };

    const attemptsLimit = Math.min(downloadUrls.length, MAX_DOWNLOAD_ATTEMPTS);

    for (let i = 0; i < attemptsLimit; i++) {
      const slowLink = downloadUrls[i];
      logger.info(`Attempting download link ${i + 1}/${attemptsLimit}...`);

      try {
        // Extract actual download URL from slow download page
        const extracted = await extractDownloadUrl(
          slowLink,
          baseUrl,
          preferredFormat,
          logger,
          flaresolverrUrl
        );

        if (!extracted) {
          logger.warn(`No download URL found on page ${i + 1}`);
          continue;
        }

        logger.info(`Downloading from: ${new URL(extracted.url).host} (format: ${extracted.format})`);

        // Build target path with actual format
        const sanitizedFilename = sanitizeFilename(`${targetFilename.replace(/\.[^.]+$/, '')}.${extracted.format}`);
        const targetPath = path.join(downloadsDir, sanitizedFilename);

        // Create download tracking entry
        const downloadId = generateDownloadId();
        const downloadEntry: ActiveDownload = {
          id: downloadId,
          requestId,
          downloadHistoryId,
          targetPath,
          bytesDownloaded: 0,
          bytesTotal: expectedSize || 0,
          startTime: Date.now(),
          lastUpdateTime: Date.now(),
          completed: false,
          failed: false,
        };
        activeDownloads.set(downloadId, downloadEntry);

        // Start download with progress tracking
        const success = await downloadFileWithProgress(
          extracted.url,
          targetPath,
          downloadEntry,
          logger
        );

        if (success) {
          downloadResult = {
            success: true,
            filePath: targetPath,
            format: extracted.format,
          };

          // Get final file size
          try {
            const stats = await fs.stat(targetPath);
            downloadEntry.bytesTotal = stats.size;
            downloadEntry.bytesDownloaded = stats.size;
          } catch {
            // Ignore stat errors
          }

          logger.info(`Download completed: ${sanitizedFilename}`);
          break;
        }

        logger.warn(`Download attempt ${i + 1} failed`);
        activeDownloads.delete(downloadId);
      } catch (error) {
        logger.warn(`Download link ${i + 1} error: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    if (!downloadResult.success) {
      // All attempts failed
      logger.error(`All ${attemptsLimit} download attempts failed`);

      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          errorMessage: downloadResult.error || 'All download attempts failed',
          updatedAt: new Date(),
        },
      });

      await prisma.downloadHistory.update({
        where: { id: downloadHistoryId },
        data: {
          downloadStatus: 'failed',
          downloadError: downloadResult.error || 'All download attempts failed',
        },
      });

      return {
        success: false,
        message: 'Download failed',
        requestId,
        error: downloadResult.error,
      };
    }

    // Download succeeded - update records and trigger organize
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'processing',
        progress: 100,
        updatedAt: new Date(),
      },
    });

    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: {
        downloadStatus: 'completed',
        completedAt: new Date(),
      },
    });

    // Get audiobook ID for organize job
    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { audiobook: true },
    });

    if (!request) {
      throw new Error('Request not found after download');
    }

    // Trigger organize files job
    const jobQueue = getJobQueueService();
    await jobQueue.addOrganizeJob(
      requestId,
      request.audiobookId,
      downloadResult.filePath!
    );

    logger.info(`Download complete, triggered organize job for ${downloadResult.filePath}`);

    return {
      success: true,
      message: 'Download completed, organizing files',
      requestId,
      filePath: downloadResult.filePath,
      format: downloadResult.format,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error during download',
        updatedAt: new Date(),
      },
    });

    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: {
        downloadStatus: 'failed',
        downloadError: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    throw error;
  }
}

/**
 * Download file with progress tracking
 */
async function downloadFileWithProgress(
  url: string,
  targetPath: string,
  tracking: ActiveDownload,
  logger: RMABLogger
): Promise<boolean> {
  try {
    // Ensure target directory exists
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    // Start download with axios streaming
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: DOWNLOAD_TIMEOUT_MS,
      headers: {
        'User-Agent': 'ReadMeABook/1.0 (Audiobook Automation)',
      },
    });

    // Get content length if available
    const contentLength = parseInt(response.headers['content-length'] || '0', 10);
    if (contentLength > 0) {
      tracking.bytesTotal = contentLength;
    }

    // Create write stream
    const writer = createWriteStream(targetPath);

    // Track progress
    let bytesDownloaded = 0;
    let lastLogTime = Date.now();
    let lastDbUpdateTime = Date.now();
    let dbUpdatePending = false; // Guard against stacking unresolved DB updates

    response.data.on('data', (chunk: Buffer) => {
      bytesDownloaded += chunk.length;
      tracking.bytesDownloaded = bytesDownloaded;
      tracking.lastUpdateTime = Date.now();

      // Log and update database every 2 seconds
      const now = Date.now();
      if (now - lastLogTime >= 2000) {
        const percent = tracking.bytesTotal > 0
          ? Math.round((bytesDownloaded / tracking.bytesTotal) * 100)
          : 0;
        const speedMBps = bytesDownloaded / ((now - tracking.startTime) / 1000) / (1024 * 1024);
        logger.info(`Download progress: ${percent}% (${(bytesDownloaded / (1024 * 1024)).toFixed(1)} MB, ${speedMBps.toFixed(2)} MB/s)`);
        lastLogTime = now;

        // Update database with progress (non-blocking, at most 1 in-flight at a time)
        if (now - lastDbUpdateTime >= PROGRESS_UPDATE_INTERVAL_MS && !dbUpdatePending) {
          lastDbUpdateTime = now;
          dbUpdatePending = true;

          prisma.request.update({
            where: { id: tracking.requestId },
            data: {
              progress: Math.min(percent, 99), // Cap at 99% until fully complete
              updatedAt: new Date(),
            },
          }).catch(() => {}).finally(() => { dbUpdatePending = false; });
        }
      }
    });

    // Pipe to file
    response.data.pipe(writer);

    // Wait for completion
    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        tracking.completed = true;
        resolve(true);
      });

      writer.on('error', (error) => {
        tracking.failed = true;
        tracking.error = error.message;
        reject(error);
      });

      response.data.on('error', (error: Error) => {
        tracking.failed = true;
        tracking.error = error.message;
        writer.close();
        // Clean up partial file
        fs.unlink(targetPath).catch(() => {});
        reject(error);
      });
    });
  } catch (error) {
    tracking.failed = true;
    tracking.error = error instanceof Error ? error.message : 'Unknown error';

    // Clean up partial file
    try {
      await fs.unlink(targetPath);
    } catch {
      // Ignore cleanup errors
    }

    return false;
  }
}

/**
 * Process monitor direct download job
 * Checks download progress and updates database
 * Note: For direct downloads, most tracking happens in processStartDirectDownload
 * This is kept for potential future use with async downloads
 */
export async function processMonitorDirectDownload(payload: MonitorDirectDownloadPayload): Promise<any> {
  const { requestId, downloadHistoryId, downloadId, targetPath, expectedSize, jobId } = payload;

  const logger = RMABLogger.forJob(jobId, 'MonitorDirectDownload');

  // Check if download is tracked
  const download = activeDownloads.get(downloadId);

  if (!download) {
    // Download not in memory - check file existence
    try {
      const stats = await fs.stat(targetPath);
      logger.info(`Download file exists: ${targetPath} (${stats.size} bytes)`);

      // If file exists and is complete, assume success
      if (expectedSize && stats.size >= expectedSize) {
        return {
          success: true,
          completed: true,
          message: 'Download already completed',
          requestId,
        };
      }
    } catch {
      // File doesn't exist
    }

    logger.warn(`Download ${downloadId} not found in tracking`);
    return {
      success: false,
      message: 'Download not found',
      requestId,
    };
  }

  // Update database with progress
  const progress = download.bytesTotal > 0
    ? Math.min(99, Math.round((download.bytesDownloaded / download.bytesTotal) * 100))
    : 0;

  const elapsed = Date.now() - download.startTime;
  const speed = elapsed > 0 ? download.bytesDownloaded / (elapsed / 1000) : 0;
  const eta = speed > 0 && download.bytesTotal > download.bytesDownloaded
    ? Math.round((download.bytesTotal - download.bytesDownloaded) / speed)
    : 0;

  await prisma.request.update({
    where: { id: requestId },
    data: {
      progress,
      updatedAt: new Date(),
    },
  });

  if (download.completed) {
    logger.info(`Download ${downloadId} completed`);
    return {
      success: true,
      completed: true,
      requestId,
      bytesDownloaded: download.bytesDownloaded,
      bytesTotal: download.bytesTotal,
    };
  }

  if (download.failed) {
    logger.error(`Download ${downloadId} failed: ${download.error}`);
    return {
      success: false,
      completed: false,
      requestId,
      error: download.error,
    };
  }

  // Still in progress - schedule another monitor
  const jobQueue = getJobQueueService();
  await jobQueue.addMonitorDirectDownloadJob(
    requestId,
    downloadHistoryId,
    downloadId,
    targetPath,
    expectedSize,
    PROGRESS_UPDATE_INTERVAL_MS / 1000
  );

  return {
    success: true,
    completed: false,
    requestId,
    progress,
    speed,
    eta,
    bytesDownloaded: download.bytesDownloaded,
    bytesTotal: download.bytesTotal,
  };
}

/**
 * Sanitize filename for filesystem
 */
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars
    .replace(/\s+/g, ' ') // Collapse spaces
    .trim()
    .substring(0, 200); // Limit length
}
