/**
 * Component: Request Cancel Service
 * Documentation: documentation/admin-features/request-cancel.md
 *
 * The one cancel path (web UI, admin table, API tokens). Authorization stays with the
 * caller. Order: one conditional write flips the status (committed before any client call), the
 * notification is queued, then the download step runs inline under a deadline and never throws.
 */

import { Prisma } from '@/generated/prisma/client';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { CANCELLABLE_STATUSES } from '../constants/request-statuses';
import { CANCEL_STEP_BUDGET_MS, CancelDeadline } from './cancel-deadline';
import { handleCancelledDownload, newestSelectedRow, type CancelDownloadOutcome } from './cancelled-download';

const logger = RMABLogger.create('RequestCancel');

/** What a cancel needs from the request (the caller has usually loaded it to authorize) */
export interface CancellableRequest {
  id: string;
  status: string;
  audiobookId: string;
  type: string;
  audiobook: { title: string; author: string };
  user: { plexUsername: string | null };
}

/** `admin`: messages may name the download client and another request sharing the download */
export type CancelAudience = 'admin' | 'owner';

/**
 * The `download` value a caller sees. Owners get `kept` for `kept_shared` and `kept_not_owned`, so
 * they can't tell that another request (maybe another user's) uses the download.
 */
export type CancelDownloadReport = CancelDownloadOutcome | 'kept';

export interface CancelOptions {
  audience: CancelAudience;
  /** Tests only */
  budgetMs?: number;
}

export type CancelResult =
  | {
      success: true;
      request: { id: string; status: 'cancelled'; cancelledAt: Date | null };
      download: CancelDownloadReport;
      message: string;
      /** A second cancel of an already-cancelled request */
      alreadyCancelled?: boolean;
    }
  | { success: false; reason: 'not_found' }
  | { success: false; reason: 'not_cancellable'; status: string };

const CANCEL_SELECT = {
  id: true,
  status: true,
  audiobookId: true,
  type: true,
  audiobook: { select: { title: true, author: true } },
  user: { select: { plexUsername: true } },
} as const;

/** Load (not deleted) and cancel. The caller must have checked the user may cancel it */
export async function cancelRequest(requestId: string, options: CancelOptions): Promise<CancelResult> {
  const record = await prisma.request.findFirst({ where: { id: requestId, deletedAt: null }, select: CANCEL_SELECT });
  if (!record) return { success: false, reason: 'not_found' };
  return cancelLoadedRequest(record, options);
}

export async function cancelLoadedRequest(record: CancellableRequest, options: CancelOptions): Promise<CancelResult> {
  if (!(CANCELLABLE_STATUSES as readonly string[]).includes(record.status)) {
    return alreadyCancelledOr(record.id, record.status);
  }

  // Only from the exact status read: a request that moved on meanwhile (e.g. to processing) is not cancelled
  const cancelledAt = new Date();
  const { count } = await prisma.request.updateMany({
    where: { id: record.id, deletedAt: null, status: record.status },
    data: {
      status: 'cancelled',
      cancelledAt,
      updatedAt: cancelledAt,
      ...(record.status === 'awaiting_approval' && { selectedTorrent: Prisma.DbNull }),
    },
  });
  if (count === 0) {
    const current = await prisma.request.findFirst({ where: { id: record.id, deletedAt: null }, select: { status: true } });
    if (!current) return { success: false, reason: 'not_found' };
    return alreadyCancelledOr(record.id, current.status);
  }

  try {
    const { getJobQueueService } = await import('./job-queue.service');
    await getJobQueueService().addNotificationJob(
      'request_cancelled',
      record.id,
      record.audiobook.title,
      record.audiobook.author,
      record.user.plexUsername || 'Unknown User'
    );
  } catch (error) {
    logger.error('Failed to queue cancellation notification', { error: error instanceof Error ? error.message : String(error) });
  }

  const deadline = CancelDeadline.in(options.budgetMs ?? CANCEL_STEP_BUDGET_MS);
  const step = await handleCancelledDownload(
    { id: record.id, audiobookId: record.audiobookId, type: record.type },
    await newestSelectedRow(record.id),
    { mode: 'cancel', deadline }
  );
  logger.info(`Cancelled request ${record.id}: download ${step.outcome} (${step.detail})`);

  return {
    success: true,
    request: { id: record.id, status: 'cancelled', cancelledAt },
    download: reportedOutcome(step.outcome, options.audience),
    message: cancelMessage(step.outcome, options.audience, step.clientName),
  };
}

export function reportedOutcome(outcome: CancelDownloadOutcome, audience: CancelAudience): CancelDownloadReport {
  return audience === 'owner' && (outcome === 'kept_shared' || outcome === 'kept_not_owned') ? 'kept' : outcome;
}

async function alreadyCancelledOr(requestId: string, status: string): Promise<CancelResult> {
  if (status !== 'cancelled') return { success: false, reason: 'not_cancellable', status };
  const row = await prisma.request.findFirst({ where: { id: requestId }, select: { cancelledAt: true } });
  return {
    success: true,
    alreadyCancelled: true,
    request: { id: requestId, status: 'cancelled', cancelledAt: row?.cancelledAt ?? null },
    download: 'none',
    message: 'This request was already cancelled.',
  };
}

/** Non-admins never see the client name or that another request shares the download */
export function cancelMessage(outcome: CancelDownloadOutcome, audience: CancelAudience, clientName?: string): string {
  const admin = audience === 'admin';
  const client = admin && clientName ? clientName : 'the download client';
  switch (outcome) {
    case 'removed':
      return `Request cancelled. Its download was removed from ${client}.`;
    case 'kept_seeding':
      return `Request cancelled. Its finished download stays in ${client} until it has seeded.`;
    case 'kept_unlimited':
      return admin
        ? `Request cancelled. Its finished download stays in ${client}: its indexer has no seeding limit.`
        : 'Request cancelled. Its finished download stays in the download client to seed.';
    // Owners get one message for both (as for the `kept` value)
    case 'kept_shared':
      return admin
        ? `Request cancelled. Its download stays in ${client}: another request still uses it.`
        : 'Request cancelled. Its download stays in the download client.';
    case 'kept_not_owned':
      return admin
        ? `Request cancelled. Its download stays in ${client}: RMAB did not add it.`
        : 'Request cancelled. Its download stays in the download client.';
    case 'kept_finished':
      return `Request cancelled. Its download had already finished and stays in ${client}.`;
    case 'retry_later':
      return admin
        ? `Request cancelled. Its download was not removed from ${client} yet; RMAB tries again on its next seeding cleanup.`
        : 'Request cancelled. RMAB tries again to remove its download on its next seeding cleanup.';
    case 'not_removed':
      return admin
        ? `Request cancelled. Its download could not be removed from ${client}; remove it there if it is no longer needed.`
        : 'Request cancelled. Its download could not be removed; an admin can remove it from the download client.';
    default:
      return 'Request cancelled.';
  }
}
