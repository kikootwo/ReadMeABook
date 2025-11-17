/**
 * Component: Retry Failed Imports Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Retries file organization for requests that are awaiting import
 */

import { prisma } from '../db';
import { createJobLogger } from '../utils/job-logger';
import { getJobQueueService } from '../services/job-queue.service';

export interface RetryFailedImportsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processRetryFailedImports(payload: RetryFailedImportsPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
  const logger = jobId ? createJobLogger(jobId, 'RetryFailedImports') : null;

  await logger?.info('Starting retry job for requests awaiting import...');

  try {
    // Find all requests in awaiting_import status
    const requests = await prisma.request.findMany({
      where: {
        status: 'awaiting_import',
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

    await logger?.info(`Found ${requests.length} requests awaiting import`);

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

        if (!downloadHistory || !downloadHistory.downloadClientId) {
          await logger?.warn(`No download history found for request ${request.id}, skipping`);
          skipped++;
          continue;
        }

        // Get download path from qBittorrent
        const { getQBittorrentService } = await import('../integrations/qbittorrent.service');
        const qbt = await getQBittorrentService();
        const torrent = await qbt.getTorrent(downloadHistory.downloadClientId);
        const downloadPath = `${torrent.save_path}/${torrent.name}`;

        await jobQueue.addOrganizeJob(
          request.id,
          request.audiobook.id,
          downloadPath,
          `/media/audiobooks/${request.audiobook.author}/${request.audiobook.title}`
        );
        triggered++;
        await logger?.info(`Triggered organize job for request ${request.id}: ${request.audiobook.title}`);
      } catch (error) {
        await logger?.error(`Failed to trigger organize for request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        skipped++;
      }
    }

    await logger?.info(`Triggered ${triggered}/${requests.length} organize jobs (${skipped} skipped)`);

    return {
      success: true,
      message: 'Retry failed imports completed',
      totalRequests: requests.length,
      triggered,
      skipped,
    };
  } catch (error) {
    await logger?.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
