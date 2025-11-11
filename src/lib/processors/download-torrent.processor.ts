/**
 * Component: Download Torrent Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { DownloadTorrentPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getQBittorrentService } from '../integrations/qbittorrent.service';

/**
 * Process download torrent job
 * Adds selected torrent to download client and starts monitoring
 */
export async function processDownloadTorrent(payload: DownloadTorrentPayload): Promise<any> {
  const { requestId, audiobook, torrent } = payload;

  console.log(`[DownloadTorrent] Processing request ${requestId} for "${audiobook.title}"`);
  console.log(`[DownloadTorrent] Selected torrent: ${torrent.title}`);

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

    // Get qBittorrent service
    const qbt = await getQBittorrentService();

    // Add torrent to qBittorrent
    console.log(`[DownloadTorrent] Adding torrent to qBittorrent: ${torrent.downloadUrl}`);

    const torrentHash = await qbt.addTorrent(torrent.downloadUrl, {
      category: 'readmeabook',
      tags: [
        'audiobook',
        `request-${requestId}`,
        `audiobook-${audiobook.id}`,
      ],
      sequentialDownload: true, // Download in order for potential streaming
      paused: false, // Start immediately
    });

    console.log(`[DownloadTorrent] Torrent added with hash: ${torrentHash}`);

    // Create DownloadHistory record
    const downloadHistory = await prisma.downloadHistory.create({
      data: {
        requestId,
        audiobookId: audiobook.id,
        downloadClient: 'qbittorrent',
        downloadClientId: torrentHash,
        torrentName: torrent.title,
        torrentHash: torrent.infoHash || torrentHash,
        size: torrent.size,
        seeders: torrent.seeders,
        status: 'downloading',
        progress: 0,
      },
    });

    console.log(`[DownloadTorrent] Created download history record: ${downloadHistory.id}`);

    // Trigger monitor download job
    const jobQueue = getJobQueueService();
    await jobQueue.addMonitorJob(
      requestId,
      downloadHistory.id,
      torrentHash,
      'qbittorrent'
    );

    console.log(`[DownloadTorrent] Started monitoring job for request ${requestId}`);

    return {
      success: true,
      message: 'Torrent added to download client and monitoring started',
      requestId,
      downloadHistoryId: downloadHistory.id,
      torrentHash,
      torrent: {
        title: torrent.title,
        size: torrent.size,
        seeders: torrent.seeders,
        format: torrent.format,
      },
    };
  } catch (error) {
    console.error('[DownloadTorrent] Error:', error);

    // Update request status to failed
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Failed to add torrent to download client',
        updatedAt: new Date(),
      },
    });

    throw error;
  }
}
