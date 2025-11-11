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

  console.log(`[MonitorDownload] Checking download ${downloadClientId} for request ${requestId}`);

  try {
    // Get download client service (currently only qBittorrent supported)
    if (downloadClient !== 'qbittorrent') {
      throw new Error(`Download client ${downloadClient} not yet supported`);
    }

    const qbt = await getQBittorrentService();

    // Get torrent status
    const torrent = await qbt.getTorrent(downloadClientId);
    const progress = qbt.getDownloadProgress(torrent);

    console.log(`[MonitorDownload] Progress: ${progress.percent}% (${progress.state})`);

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
        progress: progress.percent,
        status: progress.state,
        downloadSpeed: progress.speed,
        eta: progress.eta > 0 ? progress.eta : null,
        updatedAt: new Date(),
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
          status: 'completed',
          completedAt: new Date(),
        },
      });

      // Get audiobook details
      const downloadHistory = await prisma.downloadHistory.findUnique({
        where: { id: downloadHistoryId },
        include: {
          audiobook: true,
        },
      });

      if (!downloadHistory || !downloadHistory.audiobook) {
        throw new Error('Download history or audiobook not found');
      }

      // Trigger organize files job
      const jobQueue = getJobQueueService();
      await jobQueue.addOrganizeJob(
        requestId,
        downloadHistory.audiobookId,
        `${downloadPath}/${torrent.name}`,
        `/media/audiobooks/${downloadHistory.audiobook.author}/${downloadHistory.audiobook.title}`
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
          status: 'failed',
          errorMessage: 'Download failed in qBittorrent',
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
      // Still downloading - schedule another check in 5 seconds
      const jobQueue = getJobQueueService();
      await jobQueue.addMonitorJob(
        requestId,
        downloadHistoryId,
        downloadClientId,
        downloadClient
      );

      console.log(`[MonitorDownload] Download in progress (${progress.percent}%), will check again in 5 seconds`);

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
