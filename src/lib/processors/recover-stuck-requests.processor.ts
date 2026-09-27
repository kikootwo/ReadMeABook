/**
 * Component: Stuck Request Timeout & Recovery Processor
 * 
 * Periodically inspects requests stuck in 'searching' or 'processing' status
 * for longer than 2 hours and resets them to 'awaiting_search' or verifies active downloads.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getSABnzbdService } from '../integrations/sabnzbd.service';
import { getConfigService } from '../services/config.service';

export interface RecoverStuckRequestsPayload {
  jobId?: string;
  stuckTimeoutHours?: number;
}

export async function processRecoverStuckRequests(payload: RecoverStuckRequestsPayload = {}): Promise<any> {
  const logger = RMABLogger.forJob(payload.jobId, 'RecoverStuckRequests');
  const configService = getConfigService();

  const stuckTimeoutHours = payload.stuckTimeoutHours ?? (await configService.getStuckRequestTimeoutHours());

  if (stuckTimeoutHours === 0) {
    logger.info('Stuck request recovery is currently disabled (timeout configured to 0 hours).');
    return { success: true, disabled: true, reason: 'Stuck request recovery disabled' };
  }

  const cutoff = new Date(Date.now() - stuckTimeoutHours * 60 * 60 * 1000);
  logger.info(`Scanning for stuck requests updated before ${cutoff.toISOString()} (timeout: ${stuckTimeoutHours}h)...`);

  const stuckRequests = await prisma.request.findMany({
    where: {
      status: { in: ['searching', 'processing'] },
      updatedAt: { lt: cutoff },
      deletedAt: null,
    },
    include: {
      audiobook: true,
      downloadHistory: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (stuckRequests.length === 0) {
    logger.info('No stuck requests detected.');
    return { success: true, recoveredCount: 0 };
  }

  logger.info(`Found ${stuckRequests.length} stuck request(s). Evaluating recovery...`);

  let resetToSearchCount = 0;
  let markedDownloadingCount = 0;

  let sab: any = null;
  try {
    sab = await getSABnzbdService();
  } catch {}

  for (const req of stuckRequests) {
    const rawTitle = req.audiobook.title;
    const historyItem = Array.isArray(req.downloadHistory) ? req.downloadHistory[0] : null;
    const downloadId = historyItem?.nzbId || historyItem?.downloadClientId;

    if (req.status === 'processing' && downloadId && sab) {
      let isDownloading = false;

      try {
        const nzb = await sab.getNZB(downloadId);
        if (nzb) {
          isDownloading = true;
        }
      } catch {
        // Client check error
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
