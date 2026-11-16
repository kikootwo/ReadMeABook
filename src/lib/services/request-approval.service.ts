/**
 * Component: Request Approval Service (approve / deny)
 * Documentation: documentation/admin-features/request-approval.md
 *
 * The one approve/deny path, shared by the admin route and the Discord Approve/Deny buttons.
 * Callers check who may decide (the route: requireAdmin; Discord: the linked account's
 * database role) and pass the admin's RMAB user ID. Every request returned has passed through
 * hidePlacementRecord, read again after the decision was written. Discord is told about a
 * decision through the running-check facade, in the background: nothing here waits on it.
 */

import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { hidePlacementRecord } from '@/lib/services/request-detail-query';
import { syncDiscordApprovalDecision } from '@/lib/services/discord/discord-runtime';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog } from '@/lib/utils/zod-validation';
import { chooseApprovalPick } from './request-approval-selection';
import {
  APPROVAL_INCLUDE,
  claimFromApproval,
  findApprovalRequest,
  startApprovedRequest,
  type ApprovalRequest,
  type ApprovedStatus,
} from './request-approval-start';

const logger = RMABLogger.create('RequestApproval');

export interface ApprovalInput {
  requestId: string;
  action: 'approve' | 'deny';
  /** The deciding admin's RMAB user ID (from the session, or the linked Discord account). */
  adminId: string;
  /** Web only: a release the admin picked in interactive search. */
  adminSelectedTorrent?: unknown;
  via: 'web' | 'discord';
}

export type ApprovalResult =
  | {
      ok: true;
      action: 'approve';
      status: ApprovedStatus;
      isEbook: boolean;
      /** Set when a release was downloaded directly. */
      pickSource: 'admin' | 'user' | null;
      /** Set when the stored pick was unusable and a search ran instead. */
      droppedPickReason: string | null;
      releaseDate: Date | null;
      request: ApprovalRequest | null;
    }
  | { ok: true; action: 'deny'; request: ApprovalRequest | null }
  | { ok: false; code: 'not_found' }
  | { ok: false; code: 'invalid_status'; currentStatus: string }
  /** The release source could not be reached; nothing changed (try again). */
  | { ok: false; code: 'source_unavailable'; error: string }
  /** The admin's own pick cannot be used. */
  | { ok: false; code: 'pick_rejected'; message: string };

/** Release day as shown on the request card ("May 5, 2027"; UTC day, like the gate) */
export function formatReleaseDay(releaseDate: Date | null): string {
  return releaseDate
    ? releaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : 'unknown';
}

/** The row as it is now, for the response (hidden records dropped). */
async function readBack(id: string): Promise<ApprovalRequest | null> {
  const row = await prisma.request.findUnique({ where: { id }, include: APPROVAL_INCLUDE });
  return row ? hidePlacementRecord(row) : null;
}

/** Another decision or change won the claim: answer with what the row is now. */
async function claimLost(id: string): Promise<ApprovalResult> {
  const now = await prisma.request.findUnique({ where: { id }, select: { status: true, deletedAt: true } });
  if (!now || now.deletedAt) return { ok: false, code: 'not_found' };
  return { ok: false, code: 'invalid_status', currentStatus: now.status };
}

async function deny(existing: ApprovalRequest, input: ApprovalInput): Promise<ApprovalResult> {
  if (!(await claimFromApproval(existing.id, { status: 'denied' }))) return claimLost(existing.id);
  const request = await readBack(existing.id);
  logger.info(`Request ${existing.id} denied by admin ${input.adminId}`, {
    requestId: existing.id,
    userId: existing.userId,
    audiobookTitle: existing.audiobook.title,
    adminId: input.adminId,
    via: input.via,
  });
  syncDiscordApprovalDecision(existing.id, 'denied');
  return { ok: true, action: 'deny', request };
}

async function approve(existing: ApprovalRequest, input: ApprovalInput): Promise<ApprovalResult> {
  const pick = await chooseApprovalPick(existing, input.adminSelectedTorrent);
  if (pick.kind === 'unavailable') return { ok: false, code: 'source_unavailable', error: pick.error };
  if (pick.kind === 'rejected') return { ok: false, code: 'pick_rejected', message: pick.message };

  const isEbook = existing.type === 'ebook';
  if (pick.kind === 'download') {
    logger.info(`Request ${existing.id} has ${pick.source}-selected torrent, starting download`, {
      requestId: existing.id,
      userId: existing.userId,
      adminId: input.adminId,
      type: existing.type,
      source: pick.release?.source,
    });
  }

  const started = await startApprovedRequest(existing, pick, input.adminId);
  if (!started.claimed) return claimLost(existing.id);

  const request = await readBack(existing.id);
  const title = request?.audiobook.title ?? existing.audiobook.title;
  const author = request?.audiobook.author ?? existing.audiobook.author;
  // Send notification for manual approval
  await getJobQueueService().addNotificationJob(
    'request_approved',
    existing.id,
    isEbook ? `${title} (Ebook)` : title,
    author,
    existing.user.plexUsername || 'Unknown User'
  ).catch((error) => {
    logger.error('Failed to queue notification', { error: errorForLog(error) });
  });

  const pickSource = pick.kind === 'download' ? pick.source : null;
  logger.info(pickSource
    ? `Request ${existing.id} approved by admin ${input.adminId}, downloading ${pickSource}-selected torrent`
    : `Request ${existing.id} approved by admin ${input.adminId}`, {
    requestId: existing.id,
    userId: existing.userId,
    audiobookTitle: title,
    adminId: input.adminId,
    type: existing.type,
    via: input.via,
    ...(pickSource ? { torrentSource: pickSource } : {}),
  });
  syncDiscordApprovalDecision(existing.id, 'approved');

  return {
    ok: true,
    action: 'approve',
    status: started.status,
    isEbook,
    pickSource,
    droppedPickReason: pick.kind === 'search' ? pick.droppedPickReason : null,
    releaseDate: existing.releaseDate,
    request,
  };
}

/**
 * Approves or denies a request in awaiting_approval. A missing or deleted request is
 * `not_found`; any other status (including a decision made a moment earlier elsewhere) is
 * `invalid_status`. Errors (database, job queue) are thrown after any rollback.
 */
export async function decideRequestApproval(input: ApprovalInput): Promise<ApprovalResult> {
  const existing = await findApprovalRequest({ id: input.requestId, deletedAt: null });
  if (!existing) return { ok: false, code: 'not_found' };
  if (existing.status !== 'awaiting_approval') {
    return { ok: false, code: 'invalid_status', currentStatus: existing.status };
  }
  return input.action === 'approve' ? approve(existing, input) : deny(existing, input);
}

/** The web route's success message for an approval (unchanged wording). */
export function approvalMessage(result: Extract<ApprovalResult, { ok: true; action: 'approve' }>): string {
  if (result.pickSource) {
    return result.pickSource === 'admin'
      ? 'Request approved and download started with admin-selected torrent'
      : 'Request approved and download started with pre-selected torrent';
  }
  const searchMessage = result.status === 'awaiting_release'
    ? `Request approved; it will be searched on its release date (${formatReleaseDay(result.releaseDate)})`
    : result.isEbook
      ? 'Ebook request approved and ebook search job triggered'
      : 'Request approved and search job triggered';
  return result.droppedPickReason
    ? `The user's selected release could not be used (${result.droppedPickReason}). ${searchMessage} instead.`
    : searchMessage;
}
