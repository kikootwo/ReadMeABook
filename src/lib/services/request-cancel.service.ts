/**
 * Component: Request Cancel Service
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Shared cancel logic, extracted from PATCH /api/requests/[id] ({ action: 'cancel' }) so the Web UI
 * and the Discord bot's Cancel button and /status menu run an identical code path. Cancelling only
 * stops the request: status → 'cancelled', and the guarded background jobs (request-stop-guard)
 * stop without importing. Unlike deleteRequest, no files, library items or downloads are removed.
 */

import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { CANCELLABLE_STATUSES } from '@/lib/constants/request-statuses';
import { syncDiscordOnCancel } from '@/lib/services/discord/discord-cancel-sync';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('Service.RequestCancel');

/** The fields cancelling reads; PATCH /api/requests/[id] already loads them. */
export interface CancellableRequest {
  id: string;
  status: string;
  audiobook: { title: string; author: string };
  user: { plexUsername: string | null };
}

export interface CancelActor {
  /** RMAB user cancelling; attributes the Discord "Cancelled by" mention via their linked account */
  userId: string | null;
  /** Discord user cancelling, when the cancel came from Discord */
  discordUserId?: string | null;
}

export type CancelResult =
  | { success: true; request: any }
  | { success: false; reason: 'not_found' | 'not_cancellable'; message: string };

export function isCancellableStatus(status: string): boolean {
  return (CANCELLABLE_STATUSES as readonly string[]).includes(status);
}

/** Cancel a request the caller has already loaded and authorized. */
export async function cancelLoadedRequest(
  requestRecord: CancellableRequest,
  actor: CancelActor
): Promise<CancelResult> {
  if (!isCancellableStatus(requestRecord.status)) {
    return {
      success: false,
      reason: 'not_cancellable',
      message: `Cannot cancel request with status: ${requestRecord.status}`,
    };
  }

  const isAwaitingApproval = requestRecord.status === 'awaiting_approval';

  const updated = await prisma.request.update({
    where: { id: requestRecord.id },
    data: {
      status: 'cancelled',
      updatedAt: new Date(),
      ...(isAwaitingApproval && { selectedTorrent: Prisma.DbNull }),
    },
    include: {
      audiobook: true,
    },
  });

  try {
    const { getJobQueueService } = await import('@/lib/services/job-queue.service');
    const jobQueue = getJobQueueService();
    await jobQueue.addNotificationJob(
      'request_cancelled',
      updated.id,
      updated.audiobook.title,
      updated.audiobook.author,
      requestRecord.user.plexUsername || 'Unknown User'
    );
  } catch (error) {
    logger.error('Failed to queue cancellation notification', { error });
  }

  // Render the request card as cancelled and retract a pending approval message, from any surface.
  await syncDiscordOnCancel(updated.id, isAwaitingApproval, actor.userId, actor.discordUserId);

  return { success: true, request: updated };
}

/** Load a live request and cancel it. Authorization is the caller's job. */
export async function cancelRequest(requestId: string, actor: CancelActor): Promise<CancelResult> {
  const requestRecord = await prisma.request.findFirst({
    where: { id: requestId, deletedAt: null },
    include: {
      audiobook: true,
      user: { select: { plexUsername: true } },
    },
  });

  if (!requestRecord) {
    return { success: false, reason: 'not_found', message: 'Request not found or already deleted' };
  }

  return cancelLoadedRequest(requestRecord, actor);
}
