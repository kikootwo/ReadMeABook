/**
 * Component: Stuck Request Timeout & Recovery Processor
 * 
 * Periodically inspects requests stuck in 'searching' or 'processing' status
 * for longer than 2 hours and resets them to 'awaiting_search' or verifies active downloads.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getSABnzbdService } from '../integrations/sabnzbd.service';
import { getQBittorrentService } from '../integrations/qbittorrent.service';

export interface RecoverStuckRequestsPayload {
  jobId?: string;
  stuckTimeoutHours?: number;
}

export async function processRecoverStuckRequests(payload: RecoverStuckRequestsPayload = {}): Promise<any> {
  const { jobId, stuckTimeoutHours = 2 } = payload;
  const logger = RMABLogger.forJob(jobId, 'RecoverStuckRequests');

  const cutoff = new Date(Date.now() - stuckTimeoutHours * 60 * 60 * 1000);
  logger.info(`Scanning for stuck requests updated before ${cutoff.toISOString()}...`);

  const stuckRequests = await prisma.request.findMany({
    where: {
      status: { in: ['searching', 'processing'] },
      updatedAt: { lt: cutoff },
      deletedAt: null,
    },
    include: {
      audiobook: true,
    },
  });

  if (stuckRequests.length === 0) {
    logger.info('No stuck requests detected.');
    return { success: true, recoveredCount: 0 };
  }

  logger.info(`Found ${stuckRequests.length} stuck request(s). Evaluating recovery...`);

  let resetToSearchCount = 0;
  let markedDownloadingCount = 0;

  const sab = getSABnzbdService();
  const qbit = getQBittorrentService();

  for (const req of stuckRequests) {
    const rawTitle = req.audiobook.title;

    if (req.status === 'processing') {
      let isDownloading = false;

      // Check SABnzbd if downloadId is present
      if (req.downloadId) {
        try {
          const nzb = await sab.getNZB(req.downloadId);
          if (nzb) {
            isDownloading = true;
          }
        } catch {
          // Client check error
        }
      }

      if (isDownloading) {
        await prisma.request.update({
          where: { id: req.id },
          data: { status: 'downloading', updatedAt: new Date() },
        });
        markedDownloadingCount++;
        logger.info(`Recovered request "${rawTitle}" (${req.id}) -> marked as 'downloading'.`);
        continue;
      }
    }

    // Default recovery: reset back to awaiting_search
    await prisma.request.update({
      where: { id: req.id },
      data: {
        status: 'awaiting_search',
        updatedAt: new Date(),
      },
    });
    resetToSearchCount++;
    logger.info(`Reset stuck request "${rawTitle}" (${req.id}) from '${req.status}' -> 'awaiting_search'.`);
  }

  logger.info(`Stuck request recovery complete: ${resetToSearchCount} reset to search, ${markedDownloadingCount} updated to downloading.`);

  return {
    success: true,
    totalStuck: stuckRequests.length,
    resetToSearch: resetToSearchCount,
    markedDownloading: markedDownloadingCount,
  };
}
