/**
 * Component: Client-Reported Download Failure (next release, #332)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * A download client reported `failed`. An automatic grab whose release is at fault is blocked
 * and a fresh automatic search picks the next-ranked release, at most MAX_CLIENT_FAILURES grabs
 * in a row. Hand-picked grabs (no `clientFailures` in the payload) fail as before. Failures that
 * point at the client's storage or setup are never blocked, for any grab. Requesters and
 * notification channels see the client's name and a short reason, never the client's own text.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';
import { addAutoBlock } from '../services/blocklist.service';
import { getClientDisplayName } from '../interfaces/download-client.interface';
import { getRequestStopReason, markRequestFailedUnlessStopped } from '../utils/request-stop-guard';

type JobLogger = ReturnType<typeof RMABLogger.forJob>;

/** Releases one automatic chain may grab: client failures 1 and 2 move on, the 3rd fails the request */
export const MAX_CLIENT_FAILURES = 3;

/** Request statuses a failure may move on from: the download's own, or `searching` left by a cut earlier run */
const MOVE_ON_FROM = ['downloading', 'searching'];

/**
 * Client text (case-insensitive substring, or a whole-word error code) that points at the client's
 * storage or setup, not the release, with the short reason a requester sees instead of the text.
 */
const NOT_RELEASE_FAULT: ReadonlyArray<readonly [reason: string, patterns: ReadonlyArray<string | RegExp>]> = [
  ['disk full', ['no space left', 'disk is full', 'disk full', 'not enough space', 'unpack: space' /* NZBGet */, 'disk quota exceeded', /\bedquot\b/]],
  ['no permission', ['permission denied', 'access is denied', 'read-only file system', 'operation not permitted', /\beperm\b/]],
  ['files missing', ['missingfiles', 'no data found', 'missing or invalid torrent data', 'no such file or directory', 'cannot find the path', 'cannot find the file']],
  ['storage unavailable', ['input/output error', 'transport endpoint is not connected', 'stale file handle', 'network path was not found', 'network name is no longer available']],
  ['too many open files', ['too many open files']],
  ['files not moved', ['failed moving']],
];

/** NZBGet history statuses that are not the release's fault: deleted by the user, files not moved */
const NZBGET_NOT_RELEASE_STATUSES = new Map([['DELETED/MANUAL', 'deleted in the client'], ['FAILURE/MOVE', 'files not moved']]);

/** The short reason of a storage or setup failure, or null when the failure is the release's */
function storageFailureReason(clientType: string, errorMessage: string | null | undefined): string | null {
  const text = (errorMessage ?? '').trim();
  if (clientType === 'nzbget') {
    const status = NZBGET_NOT_RELEASE_STATUSES.get(text.split('|')[0].trim().toUpperCase());
    if (status) return status;
  }
  const lower = text.toLowerCase();
  const match = NOT_RELEASE_FAULT.find(([, patterns]) =>
    patterns.some((pattern) => (typeof pattern === 'string' ? lower.includes(pattern) : pattern.test(lower))));
  return match ? match[0] : null;
}

/**
 * True when a client-reported failure is the release's fault (block it). False for failures of
 * the client's storage or setup, which no other release would fix. NZBGet's text starts with
 * its raw history status ("DELETED/MANUAL | ...").
 */
export function isReleaseFault(clientType: string, errorMessage: string | null | undefined): boolean {
  return storageFailureReason(clientType, errorMessage) === null;
}

/** A coarse label for a release-fault failure, or null when nothing more is known */
function releaseFailureLabel(errorMessage: string | null | undefined): string | null {
  const text = (errorMessage ?? '').toLowerCase();
  if (text.includes('par') || text.includes('repair')) return 'par2';
  if (text.includes('missing articles') || text.includes('failed articles')) return 'missing articles';
  if (text.includes('unpack')) return 'unpack';
  if (text.includes('password') || text.includes('encrypted')) return 'password';
  if (text.includes('missingfiles') || text.includes('missing files')) return 'missing files';
  if (text.includes('torrent') && text.includes('error')) return 'torrent error';
  return null;
}

/**
 * Map a download client's error signal to a coarse, human-readable reason
 * for the blocklist row. Substring matching on the unified `errorMessage` is
 * intentional and acceptable per locked engineering decisions #5 and #6;
 * the raw client string is preserved in `reasonDetail`.
 */
export function classifyDownloadFailure(errorMessage: string | null | undefined): string {
  const label = releaseFailureLabel(errorMessage);
  return label ? `Download failed (${label})` : 'Download failed';
}

/**
 * The short reason a requester and notification channels see. The client's own text can hold
 * server paths, so it stays in the job log and the admin-only blocklist `reasonDetail`.
 */
export function requesterFailureReason(clientType: string, errorMessage: string | null | undefined): string | null {
  return storageFailureReason(clientType, errorMessage) ?? releaseFailureLabel(errorMessage);
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

/**
 * stopped: cancelled/deleted, nothing written. stale: an older download, request untouched.
 * already_handled: an earlier run of this failure got past its request write (or the request
 * moved on meanwhile), request untouched.
 */
export type ClientFailureOutcome = 'stopped' | 'stale' | 'already_handled' | 'next_release' | 'failed';

/** The next search's Bull job id: Bull drops a second add while it keeps the job */
export function nextReleaseSearchJobId(downloadHistoryId: string): string {
  return `next-release-${downloadHistoryId}`;
}

/** Bull's view of a run: attempts is the job's total, attemptsMade counts earlier failed attempts */
export interface BullAttempt {
  attemptsMade?: number;
  attempts?: number;
}

/** True on Bull's last attempt (no retry follows a failure); an unknown attempt counts as last */
export function isLastAttempt(attempt?: BullAttempt): boolean {
  return (attempt?.attemptsMade ?? 0) + 1 >= (attempt?.attempts ?? 1);
}

/**
 * Closing notification for a chain (at least one client failure) that ends `failed` at an exit
 * with no notification of its own: the next search threw, or the next grab failed. Call it on
 * Bull's last attempt only, once the request is (or will be) `failed`.
 */
export async function notifyChainEndedFailed(
  clientFailures: number | undefined,
  requestId: string,
  message: string,
  logger: JobLogger
): Promise<void> {
  if (!clientFailures) return;
  await notifyRequestError(requestId, message, logger);
}

/** True when this download's next search was queued: its `jobs` row has the Bull id, or Bull keeps the job */
async function nextSearchQueued(downloadHistoryId: string, logger: JobLogger): Promise<boolean> {
  const bullJobId = nextReleaseSearchJobId(downloadHistoryId);
  const searchJob = await prisma.job.findFirst({ where: { bullJobId }, select: { id: true } });
  if (searchJob) return true;
  try {
    // A kill between queue.add and the jobs-row update leaves the row without its Bull id
    return await getJobQueueService().hasBullJob(bullJobId);
  } catch (error) {
    logger.warn('Could not look up the next search in the queue', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * True when an earlier run of this failure already got past its request write. Two signals:
 * - Automatic runs only: the next search was queued. A hand-picked run never queues one, and
 *   Retry download can resume monitoring of a download whose earlier failure in a chain left
 *   that search behind; that resumed run must still end the request.
 * - The request has left `downloading` and `searching` (the next search ended, or the request
 *   already failed). The monitor marks the download row `failed` before this runs, so that row
 *   says nothing about earlier runs.
 * A cut run that wrote `searching` but queued nothing is not handled: this run queues the search.
 */
async function failureAlreadyHandled(input: ClientFailureInput): Promise<boolean> {
  if (input.clientFailures !== undefined && (await nextSearchQueued(input.downloadHistoryId, input.logger))) return true;
  const request = await prisma.request.findUnique({ where: { id: input.requestId }, select: { status: true } });
  return !MOVE_ON_FROM.includes(request?.status ?? '');
}

/** Back to `searching`, only from the download's own status (or a cut run's `searching`) */
async function moveRequestToSearching(requestId: string): Promise<boolean> {
  const { count } = await prisma.request.updateMany({
    where: { id: requestId, deletedAt: null, status: { in: MOVE_ON_FROM } },
    data: { status: 'searching', progress: 0, errorMessage: null, updatedAt: new Date() },
  });
  return count > 0;
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

/** Record this download's failure and block its release, leaving the request as it is */
async function recordWithoutRequestChange(input: ClientFailureInput, failureText: string, releaseFault: boolean): Promise<void> {
  try {
    await markHistoryFailed(input.downloadHistoryId, failureText);
    if (releaseFault) await blockFailedRelease(input);
  } catch (error) {
    input.logger.error('Failed to record the download as failed', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Handle a client-reported `failed`. Order: request write (guarded) → history `failed` → block →
 * next search → notify. Nothing after the request write throws, so a failure here never reaches
 * the monitor's generic error path (which would mark the request failed over a new chain).
 * A second run of the same failure changes nothing an earlier run did (`already_handled`).
 */
export async function handleClientReportedFailure(input: ClientFailureInput): Promise<ClientFailureOutcome> {
  const { requestId, downloadHistoryId, clientType, clientError, clientFailures, logger } = input;
  const clientName = getClientDisplayName(clientType);
  const reason = requesterFailureReason(clientType, clientError);
  // Requester-visible: the client's name and a short reason, never the client's own text
  const failureText = `Download failed in ${clientName}${reason ? ` (${reason})` : ''}`;
  const releaseFault = isReleaseFault(clientType, clientError);
  logger.warn(`${clientName} reported the download failed: ${clientError?.trim() || '(no reason given)'}`);

  // Only the request's newest selected download may change the request
  const newest = await prisma.downloadHistory.findFirst({
    where: { requestId, selected: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (newest?.id !== downloadHistoryId) {
    if (await getRequestStopReason(requestId)) return 'stopped';
    logger.warn(`Download ${downloadHistoryId} failed but is not request ${requestId}'s current download; request left unchanged`);
    await recordWithoutRequestChange(input, failureText, releaseFault);
    return 'stale';
  }

  if (await failureAlreadyHandled(input)) {
    if (await getRequestStopReason(requestId)) return 'stopped';
    logger.info(`Download ${downloadHistoryId}'s failure was already handled for request ${requestId}; request left unchanged`);
    await recordWithoutRequestChange(input, failureText, releaseFault);
    return 'already_handled';
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
    ? await moveRequestToSearching(requestId)
    : await markRequestFailedUnlessStopped(requestId, finalMessage);
  if (!written) {
    if (!mayMoveOn || (await getRequestStopReason(requestId))) {
      logger.info(`Request ${requestId} was cancelled or deleted, leaving it unchanged`);
      return 'stopped';
    }
    // The request left `downloading` meanwhile (the next search of an earlier run ended)
    logger.info(`Request ${requestId} moved on before this failure was handled; request left unchanged`);
    await recordWithoutRequestChange(input, failureText, releaseFault);
    return 'already_handled';
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
