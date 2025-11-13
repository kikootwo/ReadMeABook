/**
 * Component: Monitor Download Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { MonitorDownloadPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getQBittorrentService } from '../integrations/qbittorrent.service';

/**
 * Process monitor download job
 * Checks download progress from download client and updates request status
 * Re-schedules itself if download is still in progress
 */
export async function processMonitorDownload(payload: MonitorDownloadPayload): Promise<any> {
  const { requestId, downloadHistoryId, downloadClientId, downloadClient } = payload;

  try {
    // Get download client service (currently only qBittorrent supported)
    if (downloadClient !== 'qbittorrent') {
      throw new Error(`Download client ${downloadClient} not yet supported`);
    }

    const qbt = await getQBittorrentService();

    // Get torrent status
    const torrent = await qbt.getTorrent(downloadClientId);
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
      console.log(`[MonitorDownload] Download completed for request ${requestId}`);

      // Get torrent files to find download path
      const files = await qbt.getFiles(downloadClientId);
      const downloadPath = torrent.save_path;

      console.log(`[MonitorDownload] Downloaded to: ${downloadPath}`);
      console.log(`[MonitorDownload] Files count: ${files.length}`);

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

      console.log(`[MonitorDownload] Triggered organize_files job for request ${requestId}`);

      return {
        success: true,
        completed: true,
        message: 'Download completed, organizing files',
        requestId,
        progress: 100,
        downloadPath,
      };
    } else if (progress.state === 'failed') {
      console.error(`[MonitorDownload] Download failed for request ${requestId}`);

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
        console.log(`[MonitorDownload] Request ${requestId}: ${progress.percent}% complete (${progress.state})`);
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
    console.error('[MonitorDownload] Error:', error);

    // Update request to failed
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Monitor download failed',
        updatedAt: new Date(),
      },
    });

    throw error;
  }
}
