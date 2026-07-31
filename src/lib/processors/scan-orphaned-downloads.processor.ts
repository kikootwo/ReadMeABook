/**
 * Component: Orphaned Completed Download Scanner Processor
 * 
 * Periodically inspects completed download storage directories (/storage/downloads/nzb/complete/default/)
 * and matches un-imported folders to requests stuck in 'downloading' status,
 * automatically enqueuing 'organize_files' jobs to process them.
 */

import fs from 'fs';
import path from 'path';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';
import { cleanTitle } from '../utils/search-cleaner';

export interface ScanOrphanedDownloadsPayload {
  jobId?: string;
  downloadDir?: string;
}

export async function processScanOrphanedDownloads(payload: ScanOrphanedDownloadsPayload): Promise<any> {
  const { jobId, downloadDir = '/storage/downloads/nzb/complete/default' } = payload;
  const logger = RMABLogger.forJob(jobId, 'ScanOrphanedDownloads');

  logger.info(`Scanning completed download storage folder: ${downloadDir}`);

  if (!fs.existsSync(downloadDir)) {
    logger.warn(`Download directory does not exist: ${downloadDir}`);
    return { success: true, matched: 0, reason: 'Directory not found' };
  }

  // Find requests in downloading, awaiting_import, failed, or awaiting_search status
  const requests = await prisma.request.findMany({
    where: {
      status: { in: ['downloading', 'awaiting_import', 'failed', 'awaiting_search'] },
      deletedAt: null,
    },
    include: {
      audiobook: true,
    },
  });

  if (requests.length === 0) {
    logger.info('No requests currently in downloading or awaiting_import status.');
    return { success: true, matched: 0 };
  }

  const dirsToScan = [
    downloadDir,
    '/storage/downloads/nzb/download',
  ].filter(d => fs.existsSync(d));

  let matchedCount = 0;
  const jobQueue = getJobQueueService();

  for (const dir of dirsToScan) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const folders = entries.filter(e => e.isDirectory()).map(e => e.name);

    logger.info(`Found ${folders.length} folders in storage dir "${dir}" and ${requests.length} candidate request(s).`);

    for (const request of requests) {
      const rawTitle = request.audiobook.title;
      const cleaned = cleanTitle(rawTitle).toLowerCase().replace(/[^a-z0-9]/g, '');

      const matchingFolder = folders.find(folder => {
        const fLower = folder.toLowerCase().replace(/[^a-z0-9]/g, '');
        return fLower.includes(cleaned);
      });

      if (matchingFolder) {
        const fullPath = path.join(dir, matchingFolder);
        logger.info(`Matched orphaned download folder "${matchingFolder}" to request "${rawTitle}" (${request.id})`);

        await jobQueue.addOrganizeJob(
          request.id,
          request.audiobook.id,
          fullPath
        );
        matchedCount++;
      }
    }
  }

  logger.info(`Scan complete: ${matchedCount} orphaned download(s) matched and enqueued for organization.`);

  return {
    success: true,
    matched: matchedCount,
    totalRequests: requests.length,
  };
}
