/**
 * Component: Download Torrent Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { DownloadTorrentPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getQBittorrentService } from '../integrations/qbittorrent.service';
import { createJobLogger } from '../utils/job-logger';

/**
 * Process download torrent job
 * Adds selected torrent to download client and starts monitoring
 */
export async function processDownloadTorrent(payload: DownloadTorrentPayload): Promise<any> {
  const { requestId, audiobook, torrent, jobId } = payload;

  const logger = jobId ? createJobLogger(jobId, 'DownloadTorrent') : null;

  await logger?.info(`Processing request ${requestId} for "${audiobook.title}"`);
  await logger?.info(`Selected torrent: ${torrent.title}`, {
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

    // Get qBittorrent service
    const qbt = await getQBittorrentService();

    // Add torrent to qBittorrent
    await logger?.info(`Adding torrent to qBittorrent`);

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

    await logger?.info(`Torrent added with hash: ${torrentHash}`);

    // Create DownloadHistory record
    const downloadHistory = await prisma.downloadHistory.create({
      data: {
        requestId,
        indexerName: torrent.indexer,
        downloadClient: 'qbittorrent',
        downloadClientId: torrentHash,
        torrentName: torrent.title,
        torrentHash: torrent.infoHash || torrentHash,
        torrentSizeBytes: torrent.size,
        seeders: torrent.seeders,
        leechers: torrent.leechers || 0,
        downloadStatus: 'downloading',
        selected: true,
        startedAt: new Date(),
      },
    });

    await logger?.info(`Created download history record: ${downloadHistory.id}`);

    // Trigger monitor download job with initial delay
    // qBittorrent needs a few seconds to process the torrent before it's available via API
    const jobQueue = getJobQueueService();
    await jobQueue.addMonitorJob(
      requestId,
      downloadHistory.id,
      torrentHash,
      'qbittorrent',
      3 // Wait 3 seconds before first check to avoid race condition
    );

    await logger?.info(`Started monitoring job for request ${requestId} (3s initial delay)`);

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
    await logger?.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

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
