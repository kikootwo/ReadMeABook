/**
 * Component: Async Bulk Import Batch Processor
 * 
 * Processes high-volume bulk imports (e.g. 3,000+ books) asynchronously in 100-item chunks.
 * Enqueues search indexer jobs cleanly with Bull queue rate-limiting protection.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';
import { getAudibleService } from '../integrations/audible.service';

export interface BulkImportItem {
  folderPath?: string;
  asin?: string;
  title?: string;
  author?: string;
}

export interface BulkImportBatchPayload {
  jobId?: string;
  userId: string;
  imports: BulkImportItem[];
}

export async function processBulkImportBatch(payload: BulkImportBatchPayload): Promise<any> {
  const { jobId, userId, imports } = payload;
  const logger = RMABLogger.forJob(jobId, 'BulkImportBatch');

  logger.info(`Starting asynchronous batch bulk import of ${imports.length} items for user ${userId}...`);

  const jobQueue = getJobQueueService();
  const audibleService = getAudibleService();

  const CHUNK_SIZE = 100;
  let totalProcessed = 0;
  let totalQueued = 0;

  for (let i = 0; i < imports.length; i += CHUNK_SIZE) {
    const chunk = imports.slice(i, i + CHUNK_SIZE);
    logger.info(`Processing chunk ${Math.floor(i / CHUNK_SIZE) + 1} of ${Math.ceil(imports.length / CHUNK_SIZE)} (${chunk.length} items)...`);

    for (const item of chunk) {
      totalProcessed++;
      try {
        let audiobookRecord: { id: string; title: string; author: string; audibleAsin?: string | null } | null = null;

        if (item.asin) {
          const existing = await prisma.audiobook.findFirst({ where: { audibleAsin: item.asin } });
          if (existing) {
            audiobookRecord = existing;
          } else {
            const cached = await prisma.audibleCache.findUnique({ where: { asin: item.asin } });
            if (cached) {
              audiobookRecord = await prisma.audiobook.create({
                data: {
                  audibleAsin: item.asin,
                  title: cached.title,
                  author: cached.author,
                  coverArtUrl: cached.coverArtUrl,
                  narrator: cached.narrator,
                  status: 'pending',
                },
              });
            }
          }
        }

        if (!audiobookRecord && item.title && item.author) {
          audiobookRecord = await prisma.audiobook.create({
            data: {
              title: item.title,
              author: item.author,
              status: 'pending',
            },
          });
        }

        if (audiobookRecord) {
          const newReq = await prisma.request.create({
            data: {
              userId,
              audiobookId: audiobookRecord.id,
              type: 'audiobook',
              status: 'awaiting_search',
            },
          });
          await jobQueue.addSearchJob(newReq.id, {
            id: audiobookRecord.id,
            title: audiobookRecord.title,
            author: audiobookRecord.author,
            asin: audiobookRecord.audibleAsin || undefined,
          });
          totalQueued++;
        }
      } catch (err) {
        logger.warn(`Failed to process item ${item.asin || item.title}`, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  logger.info(`Async bulk import complete: ${totalProcessed} processed, ${totalQueued} search jobs enqueued.`);

  return {
    success: true,
    totalProcessed,
    totalQueued,
  };
}
