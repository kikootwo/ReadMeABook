/**
 * Component: Request Approval Start (claim, enqueue, rollback)
 * Documentation: documentation/admin-features/request-approval.md
 *
 * Moves an approved request out of awaiting_approval and starts it. The move is one
 * conditional write (`updateMany` where status is still awaiting_approval and the row is not
 * deleted), so of two decisions made at once (web and Discord, or two admins) exactly one
 * starts the request. The row is read back right after the claim, so the response shows the
 * status the claim set. If queueing the work then fails, the row goes back to awaiting_approval
 * with its stored pick and approval record, but only while it still has the status this claim
 * set and is not deleted (a job that already moved it on is left alone). Once the job is in the
 * queue it runs, so a failure after that point (recording the job's Bull ID) is logged and the
 * request stays started.
 */

import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { shouldWaitForRelease } from '@/lib/services/release-gate';
import { hidePlacementRecord } from '@/lib/services/request-detail-query';
import { buildEbookDownloadName } from '@/lib/utils/ebook-download-name';
import { jobWasQueued } from '@/lib/utils/job-queued-error';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog } from '@/lib/utils/zod-validation';
import type { ApprovalPick } from './request-approval-selection';

type DownloadPick = Extract<ApprovalPick, { kind: 'download' }>;

const logger = RMABLogger.create('RequestApproval');

/** The relations every approval read returns (and every response carries). */
export const APPROVAL_INCLUDE = {
  audiobook: true,
  user: { select: { id: true, plexUsername: true } },
} as const;

/** A request with the approval relations (`where` may add deletedAt etc.). */
export function findApprovalRequest(where: Prisma.RequestWhereInput) {
  return prisma.request.findFirst({ where, include: APPROVAL_INCLUDE });
}

export type ApprovalRequest = NonNullable<Awaited<ReturnType<typeof findApprovalRequest>>>;

export type ApprovedStatus = 'downloading' | 'pending' | 'awaiting_release';

export type StartResult =
  | { claimed: false }
  /** `request`: the row as read right after the claim (hidden records dropped). */
  | { claimed: true; status: ApprovedStatus; request: ApprovalRequest };

/** Errors from a start whose claim still stands (the rollback did not put the row back), with the status it set. */
const claimKept = new WeakMap<object, ApprovedStatus>();

/** The status the claim set when `error` came from a start that left the request out of awaiting_approval, else null. */
export function keptClaimStatus(error: unknown): ApprovedStatus | null {
  return typeof error === 'object' && error !== null ? claimKept.get(error) ?? null : null;
}

/** True when `error` came from a start that left the request out of awaiting_approval. */
export function claimWasKept(error: unknown): boolean {
  return keptClaimStatus(error) !== null;
}

/** One conditional write: true when this caller moved the row out of awaiting_approval. */
export async function claimFromApproval(id: string, data: Prisma.RequestUpdateManyMutationInput): Promise<boolean> {
  const { count } = await prisma.request.updateMany({ where: { id, status: 'awaiting_approval', deletedAt: null }, data });
  return count === 1;
}

/**
 * The row right after a claim, for the response. If it cannot be read, the row as it was with
 * the claim's fields applied (the claim is already written; the response must not fail).
 */
export async function readClaimed(existing: ApprovalRequest, claimed: Partial<ApprovalRequest>): Promise<ApprovalRequest> {
  try {
    const row = await prisma.request.findUnique({ where: { id: existing.id }, include: APPROVAL_INCLUDE });
    if (row) return hidePlacementRecord(row);
  } catch (error) {
    logger.warn(`Could not read request ${existing.id} after the decision`, { error: errorForLog(error) });
  }
  return hidePlacementRecord({ ...existing, ...claimed });
}

/**
 * Runs `enqueue`; on failure puts the claimed row back to awaiting_approval, then rethrows.
 * A failure after the job was queued is not rolled back: the job runs, so the request stays started.
 */
async function enqueueOrRollBack(existing: ApprovalRequest, claimed: ApprovedStatus, enqueue: () => Promise<void>): Promise<void> {
  try {
    await enqueue();
  } catch (error) {
    if (jobWasQueued(error)) {
      logger.warn(`The job for approved request ${existing.id} is queued but its record could not be completed`, {
        requestId: existing.id,
        error: errorForLog(error),
      });
      return;
    }
    let restored = false;
    try {
      const result = await prisma.request.updateMany({
        where: { id: existing.id, status: claimed, deletedAt: null },
        data: {
          status: 'awaiting_approval',
          selectedTorrent: (existing.selectedTorrent ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
          approvalBypassedBy: existing.approvalBypassedBy,
        },
      });
      restored = result.count === 1;
    } catch (rollbackError) {
      logger.error(`Could not put request ${existing.id} back to awaiting approval`, { error: errorForLog(rollbackError) });
    }
    logger.error(`Could not start approved request ${existing.id}`, {
      requestId: existing.id,
      restoredToAwaitingApproval: restored,
      error: errorForLog(error),
    });
    if (!restored && typeof error === 'object' && error !== null) claimKept.set(error, claimed);
    throw error;
  }
}

/** Downloads the chosen release: Anna's Archive ebook picks as a direct download, the rest through the client. */
async function startDownload(existing: ApprovalRequest, release: DownloadPick['release']): Promise<StartResult> {
  const claimed = await claimFromApproval(existing.id, {
    status: 'downloading',
    selectedTorrent: null as any, // Clear after use
    approvalBypassedBy: null, // approved now: clears an earlier record (#232)
  });
  if (!claimed) return { claimed: false };
  const request = await readClaimed(existing, { status: 'downloading', selectedTorrent: null, approvalBypassedBy: null });

  const jobQueue = getJobQueueService();
  await enqueueOrRollBack(existing, 'downloading', async () => {
    if (existing.type === 'ebook' && release.source === 'annas_archive') {
      const format = release.format || 'epub';
      const downloadHistory = await prisma.downloadHistory.create({
        data: {
          requestId: existing.id,
          indexerName: "Anna's Archive",
          torrentName: `${existing.audiobook.title} - ${existing.audiobook.author}.${format}`,
          torrentSizeBytes: null,
          qualityScore: release.score || 100,
          selected: true,
          downloadClient: 'direct',
          downloadStatus: 'queued',
        },
      });
      // Store all download URLs for retry purposes
      if (release.downloadUrls && release.downloadUrls.length > 0) {
        await prisma.downloadHistory.update({
          where: { id: downloadHistory.id },
          data: { torrentUrl: JSON.stringify(release.downloadUrls) },
        });
      }
      await jobQueue.addStartDirectDownloadJob(
        existing.id,
        downloadHistory.id,
        release.downloadUrl,
        buildEbookDownloadName(existing.audiobook.title, existing.audiobook.author, format),
        undefined
      );
      return;
    }
    // Audiobook or indexer ebook: the download client takes the pre-selected release
    await jobQueue.addDownloadJob(
      existing.id,
      { id: existing.audiobook.id, title: existing.audiobook.title, author: existing.audiobook.author },
      release
    );
  });
  return { claimed: true, status: 'downloading', request };
}

/**
 * No usable release: the type's automatic search, unless the book is unreleased and the
 * release gate says wait (same check as request creation; ebook requests never wait there).
 */
async function startSearch(existing: ApprovalRequest, adminId: string): Promise<StartResult> {
  const isEbook = existing.type === 'ebook';
  const waitForRelease = !isEbook && await shouldWaitForRelease(existing.releaseDate);
  logger.info(waitForRelease
    ? `Request ${existing.id} is unreleased; waiting for its release date before searching`
    : `Request ${existing.id} using automatic search`, {
    requestId: existing.id,
    userId: existing.userId,
    adminId,
    type: existing.type,
    ...(waitForRelease ? { releaseDate: existing.releaseDate?.toISOString() ?? null } : {}),
  });

  // awaiting_release: retry_missing_torrents starts the search on release day
  const status: ApprovedStatus = waitForRelease ? 'awaiting_release' : 'pending';
  const claimed = await claimFromApproval(existing.id, {
    status,
    approvalBypassedBy: null, // approved now: clears an earlier record (#232)
    // Drop an unusable stored pick so it can't be approved again
    ...(existing.selectedTorrent ? { selectedTorrent: Prisma.DbNull } : {}),
  });
  if (!claimed) return { claimed: false };
  const request = await readClaimed(existing, {
    status,
    approvalBypassedBy: null,
    ...(existing.selectedTorrent ? { selectedTorrent: null } : {}),
  });
  // Searched later by the daily retry job
  if (waitForRelease) return { claimed: true, status, request };

  const jobQueue = getJobQueueService();
  const book = {
    id: existing.audiobook.id,
    title: existing.audiobook.title,
    author: existing.audiobook.author,
    asin: existing.audiobook.audibleAsin || undefined,
  };
  await enqueueOrRollBack(existing, status, async () => {
    if (isEbook) await jobQueue.addSearchEbookJob(existing.id, book);
    else await jobQueue.addSearchJob(existing.id, book);
  });
  return { claimed: true, status, request };
}

/** Claims and starts an approved request with the chosen release (or a search). */
export function startApprovedRequest(
  existing: ApprovalRequest,
  pick: Extract<ApprovalPick, { kind: 'download' | 'search' }>,
  adminId: string
): Promise<StartResult> {
  return pick.kind === 'download' ? startDownload(existing, pick.release) : startSearch(existing, adminId);
}
