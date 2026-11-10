/**
 * Component: Client-Reported Download Failure (next release, #332)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * A download client reported `failed`. An automatic grab whose release is at fault is blocked
 * and a fresh automatic search picks the next-ranked release, at most MAX_CLIENT_FAILURES grabs
 * in a row. Hand-picked grabs (no `clientFailures` in the payload) fail as before. Failures that
 * point at the client's storage or setup are never blocked, for any grab.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';
import { addAutoBlock } from '../services/blocklist.service';
import { getClientDisplayName } from '../interfaces/download-client.interface';
import { getRequestStopReason, markRequestFailedUnlessStopped, updateRequestUnlessStopped } from '../utils/request-stop-guard';

type JobLogger = ReturnType<typeof RMABLogger.forJob>;

/** Releases one automatic chain may grab: client failures 1 and 2 move on, the 3rd fails the request */
export const MAX_CLIENT_FAILURES = 3;
/** Client text kept in the request message and notification */
const DETAIL_MAX = 200;

/**
 * Client text (case-insensitive) that points at the client's storage or setup, not the release:
 * full disk, permissions, missing data or an unmounted path, files that could not be moved.
 */
const NOT_RELEASE_FAULT_TEXT = [
  'no space left', 'disk is full', 'disk full', 'not enough space',
  'permission denied', 'access is denied', 'read-only file system',
  'missingfiles', 'no data found', 'missing or invalid torrent data', 'no such file or directory',
  'cannot find the path', 'cannot find the file', 'input/output error',
  'transport endpoint is not connected', 'stale file handle',
  'failed moving',
];

/** NZBGet history statuses that are not the release's fault: deleted by the user, files not moved */
const NZBGET_NOT_RELEASE_STATUSES = new Set(['DELETED/MANUAL', 'FAILURE/MOVE']);

/**
 * True when a client-reported failure is the release's fault (block it). False for failures of
 * the client's storage or setup, which no other release would fix. NZBGet's text starts with
 * its raw history status ("DELETED/MANUAL | ...").
 */
export function isReleaseFault(clientType: string, errorMessage: string | null | undefined): boolean {
  const text = (errorMessage ?? '').trim();
  if (clientType === 'nzbget' && NZBGET_NOT_RELEASE_STATUSES.has(text.split('|')[0].trim().toUpperCase())) {
    return false;
  }
  const lower = text.toLowerCase();
  return !NOT_RELEASE_FAULT_TEXT.some((pattern) => lower.includes(pattern));
}

/**
 * Map a download client's error signal to a coarse, human-readable reason
 * for the blocklist row. Substring matching on the unified `errorMessage` is
 * intentional and acceptable per locked engineering decisions #5 and #6;
 * the raw client string is preserved in `reasonDetail`.
 */
export function classifyDownloadFailure(errorMessage: string | null | undefined): string {
  const text = (errorMessage ?? '').toLowerCase();
  if (!text) return 'Download failed';
  if (text.includes('par') || text.includes('repair')) return 'Download failed (par2)';
  if (text.includes('missing articles') || text.includes('failed articles')) return 'Download failed (missing articles)';
  if (text.includes('unpack')) return 'Download failed (unpack)';
  if (text.includes('password') || text.includes('encrypted')) return 'Download failed (password)';
  if (text.includes('missingfiles') || text.includes('missing files')) return 'Download failed (missing files)';
  if (text.includes('torrent') && text.includes('error')) return 'Download failed (torrent error)';
  return 'Download failed';
}

/** Queue a request_error notification. Never throws: a lookup or queueing failure is logged. */
export async function notifyRequestError(requestId: string, message: string, logger: JobLogger): Promise<void> {
  try {
    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: {
        audiobook: true,
        user: { select: { plexUsername: true } },
      },
    });
    if (!request) return;

    await getJobQueueService().addNotificationJob(
      'request_error',
      request.id,
      request.audiobook.title,
      request.audiobook.author,
      request.user.plexUsername || 'Unknown User',
      message
    );
  } catch (error) {
    logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
  }
}

export interface ClientFailureInput {
  requestId: string;
  downloadHistoryId: string;
  clientType: string;
  /** The client's own failure text (DownloadInfo.errorMessage) */
  clientError: string | null;
  /** Release failures so far in this automatic chain; undefined = a hand-picked grab (never moves on) */
  clientFailures: number | undefined;
  jobId?: string;
  logger: JobLogger;
}

/** stopped: cancelled/deleted, nothing written. stale: an older download, request untouched. */
export type ClientFailureOutcome = 'stopped' | 'stale' | 'next_release' | 'failed';

/** The next search's Bull job id: a second run of the same failure never queues a second search */
export function nextReleaseSearchJobId(downloadHistoryId: string): string {
  return `next-release-${downloadHistoryId}`;
}

/** Block the failed release; true only when a blocklist row exists for it afterwards */
async function blockFailedRelease(input: ClientFailureInput): Promise<boolean> {
  const failed = await prisma.downloadHistory.findUnique({ where: { id: input.downloadHistoryId } });
  if (!failed?.torrentName) return false;
  const { blocked } = await addAutoBlock({
    requestId: input.requestId,
    releaseName: failed.torrentName,
    releaseHash: failed.torrentHash ?? failed.nzbId ?? null,
    indexerName: failed.indexerName ?? null,
    indexerId: failed.indexerId ?? null,
    source: 'download_fail',
    reason: classifyDownloadFailure(input.clientError),
    reasonDetail: input.clientError,
    downloadHistoryId: failed.id,
    jobId: input.jobId,
  });
  return blocked !== null;
}

async function markHistoryFailed(downloadHistoryId: string, downloadError: string): Promise<void> {
  await prisma.downloadHistory.update({
    where: { id: downloadHistoryId },
    data: { downloadStatus: 'failed', downloadError },
  });
}

/** Queue the automatic search for the next-ranked release, carrying the failure count */
async function queueNextReleaseSearch(input: ClientFailureInput, failures: number): Promise<void> {
  const request = await prisma.request.findUnique({
    where: { id: input.requestId },
    select: { audiobook: { select: { id: true, title: true, author: true, audibleAsin: true } } },
  });
  if (!request?.audiobook) throw new Error('Request or audiobook not found');
  const { id, title, author, audibleAsin } = request.audiobook;
  await getJobQueueService().addSearchJob(
    input.requestId,
    { id, title, author, asin: audibleAsin || undefined },
    { clientFailures: failures, jobId: nextReleaseSearchJobId(input.downloadHistoryId) }
  );
}

/**
 * Handle a client-reported `failed`. Order: request write (guarded) → history `failed` → block →
 * next search → notify. Nothing after the request write throws, so a failure here never reaches
 * the monitor's generic error path (which would mark the request failed over a new chain).
 */
export async function handleClientReportedFailure(input: ClientFailureInput): Promise<ClientFailureOutcome> {
  const { requestId, downloadHistoryId, clientType, clientError, clientFailures, logger } = input;
  const detail = (clientError ?? '').trim().slice(0, DETAIL_MAX);
  const failureText = `Download failed in ${getClientDisplayName(clientType)}${detail ? ` (${detail})` : ''}`;
  const releaseFault = isReleaseFault(clientType, clientError);

  // Only the request's newest selected download may change the request
  const newest = await prisma.downloadHistory.findFirst({
    where: { requestId, selected: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (newest?.id !== downloadHistoryId) {
    if (await getRequestStopReason(requestId)) return 'stopped';
    logger.warn(`Download ${downloadHistoryId} failed but is not request ${requestId}'s current download; request left unchanged`);
    try {
      await markHistoryFailed(downloadHistoryId, failureText);
      if (releaseFault) await blockFailedRelease(input);
    } catch (error) {
      logger.error('Failed to record the earlier download as failed', { error: error instanceof Error ? error.message : String(error) });
    }
    return 'stale';
  }

  const failures = (clientFailures ?? 0) + 1;
  const automatic = clientFailures !== undefined;
  const mayMoveOn = automatic && releaseFault && failures < MAX_CLIENT_FAILURES;
  const finalMessage = !releaseFault
    ? `${failureText}: a problem with the download client or its storage, not the release, so the release was not blocked`
    : automatic && failures >= MAX_CLIENT_FAILURES
      ? `${MAX_CLIENT_FAILURES} releases in a row failed in the download client; last: ${failureText}`
      : failureText;

  const written = mayMoveOn
    ? await updateRequestUnlessStopped(requestId, { status: 'searching', progress: 0, errorMessage: null })
    : await markRequestFailedUnlessStopped(requestId, finalMessage);
  if (!written) {
    logger.info(`Request ${requestId} was cancelled or deleted, leaving it unchanged`);
    return 'stopped';
  }

  let searchQueued = false;
  try {
    await markHistoryFailed(downloadHistoryId, failureText);
    const blocked = releaseFault ? await blockFailedRelease(input) : false;

    if (!mayMoveOn) {
      await notifyRequestError(requestId, finalMessage, logger);
      return 'failed';
    }
    if (!blocked) {
      // The same release could be ranked first again: fail as before instead of moving on
      logger.warn(`Could not block the failed release for request ${requestId}; not trying another release`);
      if (await markRequestFailedUnlessStopped(requestId, failureText)) await notifyRequestError(requestId, failureText, logger);
      return 'failed';
    }

    await queueNextReleaseSearch(input, failures);
    searchQueued = true;
    logger.info(`Release failed in ${getClientDisplayName(clientType)}; searching for another release (attempt ${failures + 1} of ${MAX_CLIENT_FAILURES})`);
    await notifyRequestError(
      requestId,
      `${failureText}. Trying another release (attempt ${failures + 1} of ${MAX_CLIENT_FAILURES}).`,
      logger
    );
    return 'next_release';
  } catch (error) {
    logger.error(`Error handling the failed download for request ${requestId}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    if (searchQueued) return 'next_release';
    if (!mayMoveOn) {
      await notifyRequestError(requestId, finalMessage, logger);
      return 'failed';
    }
    // The request says "searching" but no search runs: end it as a plain failure
    try {
      if (await markRequestFailedUnlessStopped(requestId, failureText)) await notifyRequestError(requestId, failureText, logger);
    } catch (writeError) {
      logger.error('Failed to mark the request failed', { error: writeError instanceof Error ? writeError.message : String(writeError) });
    }
    return 'failed';
  }
}
