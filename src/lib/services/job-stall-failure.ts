/**
 * Component: Stall-Limit Failure Handler (jobs cut twice by a stop or crash)
 * Documentation: documentation/backend/services/jobs.md
 *
 * Bull reruns a job left active by a dead process once (maxStalledCount 1); a
 * second cut fails it with "job stalled more than allowable limit", skipping
 * attempts and backoff. Without this the request stays 'processing' or
 * 'downloading' forever. Acts on that failure only, for organize_files and
 * start_direct_download, and only while the request is still in the status the
 * cut job left it in.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import type { JobActivityTracker } from './job-activity-tracker';

const logger = RMABLogger.create('JobQueue');

/** Bull's error for a job that stalled more often than maxStalledCount */
export const STALL_LIMIT_MESSAGE = 'job stalled more than allowable limit';

/** Job types that move a request into a status only they move it out of */
const GUARDED_TYPES = ['organize_files', 'start_direct_download'] as const;

/** A download row recorded as gone stays gone (a bare `not` would skip NULL statuses too) */
const NOT_REMOVED = { OR: [{ downloadStatus: null }, { downloadStatus: { not: 'removed' } }] };

export const INTERRUPTED_IMPORT_MESSAGE = 'Import was interrupted when the app stopped; it will be retried';
export const INTERRUPTED_DOWNLOAD_MESSAGE = 'Download was interrupted when the app stopped. Try the download again.';

interface StalledJob {
  id?: unknown;
  name?: string;
  data?: Record<string, unknown> | null;
}

/**
 * Put the request of a stall-failed organize or direct-download job back into a
 * status the app can move on from. Never throws.
 */
export async function handleStallLimitFailure(
  job: StalledJob | null | undefined,
  error: Error | null | undefined,
  activity: JobActivityTracker
): Promise<void> {
  if (!job || error?.message !== STALL_LIMIT_MESSAGE) return;
  if (job.name !== 'organize_files' && job.name !== 'start_direct_download') return;
  const data = job.data ?? {};
  const requestId = typeof data.requestId === 'string' && data.requestId ? data.requestId : undefined;
  if (!requestId) return;

  // Also fires for a job still running here with its event loop blocked past the lock;
  // resetting its request would queue a second organize beside it.
  const running = activity.activeForRequest(requestId, GUARDED_TYPES);
  if (running.length > 0) {
    logger.warn(`Job ${String(job.id)} hit the stall limit, but ${running.map((j) => `${j.name} ${j.id}`).join(', ')} still runs for request ${requestId}; leaving the request as it is`);
    return;
  }

  try {
    if (job.name === 'organize_files') await resetInterruptedImport(requestId, data);
    else await failInterruptedDirectDownload(requestId, data);
  } catch (err) {
    logger.error(`Failed to reset request ${requestId} after ${job.name} hit the stall limit`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function resetInterruptedImport(requestId: string, data: Record<string, unknown>): Promise<void> {
  // Manual imports pass cleanupSource true, bulk imports false; their folder and file
  // choice live only in the payload, and the import retry would re-queue the request's
  // last client download instead (same rule as organize-files.processor.ts).
  const isManualImport = !data.downloadHistoryId && typeof data.cleanupSource === 'boolean';
  if (isManualImport) {
    const from = typeof data.downloadPath === 'string' ? ` from ${data.downloadPath}` : '';
    const { count } = await prisma.request.updateMany({
      where: { id: requestId, status: 'processing', deletedAt: null },
      data: {
        status: 'failed',
        errorMessage: `Import${from} was interrupted when the app stopped. Run the import again.`,
        updatedAt: new Date(),
      },
    });
    logOutcome(requestId, count, 'failed (manual import)');
    return;
  }

  const request = await prisma.request.findFirst({
    where: { id: requestId, status: 'processing', deletedAt: null },
    select: { importAttempts: true, maxImportRetries: true },
  });
  if (!request) {
    logOutcome(requestId, 0, 'awaiting_import');
    return;
  }

  // Counts against the import retries, as the organize processor does
  const attempts = request.importAttempts + 1;
  const retry = attempts < request.maxImportRetries;
  const { count } = await prisma.request.updateMany({
    // importAttempts in the filter: a concurrent writer since the read wins
    where: { id: requestId, status: 'processing', deletedAt: null, importAttempts: request.importAttempts },
    data: retry
      ? {
          status: 'awaiting_import',
          importAttempts: attempts,
          lastImportAt: new Date(),
          errorMessage: `${INTERRUPTED_IMPORT_MESSAGE}. Retry ${attempts}/${request.maxImportRetries}`,
          updatedAt: new Date(),
        }
      : {
          status: 'warn',
          importAttempts: attempts,
          errorMessage: `Import was interrupted when the app stopped. Max retries (${request.maxImportRetries}) exceeded. Manual retry available.`,
          updatedAt: new Date(),
        },
  });
  logOutcome(requestId, count, retry ? 'awaiting_import' : 'warn');
}

async function failInterruptedDirectDownload(requestId: string, data: Record<string, unknown>): Promise<void> {
  const downloadHistoryId = typeof data.downloadHistoryId === 'string' ? data.downloadHistoryId : undefined;
  if (!downloadHistoryId) return;

  // Only the request's current download: a newer selection has its own job
  const selected = await prisma.downloadHistory.findFirst({
    where: { requestId, selected: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (selected?.id !== downloadHistoryId) {
    logger.info(`Direct download ${downloadHistoryId} is no longer the selected download of request ${requestId}; leaving the request as it is`);
    return;
  }

  const { count } = await prisma.request.updateMany({
    where: { id: requestId, status: 'downloading', deletedAt: null },
    data: { status: 'failed', errorMessage: INTERRUPTED_DOWNLOAD_MESSAGE, updatedAt: new Date() },
  });
  logOutcome(requestId, count, 'failed (direct download)');
  if (count === 0) return;

  // Never over a row a cancel or cleanup recorded as gone (same rule as monitor-download)
  await prisma.downloadHistory.updateMany({
    where: { id: downloadHistoryId, ...NOT_REMOVED },
    data: { downloadStatus: 'failed', downloadError: INTERRUPTED_DOWNLOAD_MESSAGE },
  });
}

function logOutcome(requestId: string, count: number, target: string): void {
  if (count > 0) logger.warn(`Request ${requestId} was cut twice by a stop or crash; moved to ${target}`);
  else logger.info(`Request ${requestId} already moved on (or was cancelled or deleted); leaving it as it is`);
}
