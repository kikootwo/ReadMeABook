/**
 * Component: Request Approval Service
 * Documentation: documentation/admin-features/request-approval.md
 *
 * Shared approve/deny logic for requests in 'awaiting_approval' status. Extracted from the
 * approve API route so both the Web UI (POST /api/admin/requests/[id]/approve) and the Discord
 * bot's Approve/Deny buttons run an identical code path. Returns a structured result; the caller
 * is responsible for mapping it to an HTTP response or a Discord reply.
 */

import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('Service.RequestApproval');

export type ApprovalAction = 'approve' | 'deny';

export interface ProcessApprovalInput {
  requestId: string;
  action: ApprovalAction;
  /** RMAB user ID of the actor approving/denying (admin). Used for logging. */
  adminUserId: string;
  /** Optional torrent selected by the admin during interactive search. */
  selectedTorrent?: unknown;
}

export type ApprovalResult =
  | { success: true; message: string; request: any }
  | {
      success: false;
      /** Machine-readable reason: 'not_found' | 'invalid_status' | 'error'. */
      reason: 'not_found' | 'invalid_status' | 'error';
      message: string;
      currentStatus?: string;
    };

/**
 * Result for when the atomic claim found the request no longer 'awaiting_approval' (a concurrent
 * actor already approved/denied it). Reports the current status so the caller can surface it.
 */
async function staleStatusResult(id: string): Promise<ApprovalResult> {
  const current = await prisma.request.findUnique({
    where: { id },
    select: { status: true, deletedAt: true },
  });

  // A soft-deleted row is gone as far as approval is concerned: the claim failed because the
  // request was cancelled, not because a concurrent actor decided it first.
  if (!current || current.deletedAt) {
    return { success: false, reason: 'not_found', message: 'Request not found' };
  }

  return {
    success: false,
    reason: 'invalid_status',
    message: `Request is not awaiting approval (current status: ${current.status})`,
    currentStatus: current.status,
  };
}

/**
 * Undo an atomic claim after the follow-up enqueue failed, returning the request to
 * 'awaiting_approval' (and restoring the torrent the claim cleared) so an admin can simply click
 * Approve again. The old route enqueued first and flipped status second, so an enqueue failure was
 * naturally harmless; claiming first closed the double-approve race but made a failed enqueue strand
 * the row in 'downloading' with no job attached.
 *
 * Gated on the status the claim actually set, so a concurrent transition is never clobbered.
 * Best-effort: a failure here is logged, not thrown, since the caller is already returning an error.
 */
async function releaseClaim(
  id: string,
  claimedStatus: string,
  torrentToRestore: unknown
): Promise<void> {
  try {
    await prisma.request.updateMany({
      where: { id, status: claimedStatus },
      data: {
        status: 'awaiting_approval',
        selectedTorrent: (torrentToRestore ?? null) as any,
      },
    });
  } catch (error) {
    logger.error('Failed to roll back approval claim after enqueue failure', {
      requestId: id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Rewrite the Discord surfaces after an approve/deny: mark the approval message decided (dropping
 * its Approve/Deny buttons), refresh the requester's live request card, and DM them the outcome.
 *
 * Lives here rather than in the Discord button handler so every surface converges -- the Web UI
 * Deny button and API-token decisions previously left the approval embed live and notified nobody,
 * which is what made a stale embed clickable long after the decision was made.
 *
 * Gated on a running bot and dynamically imported so discord.js stays unloaded when the bot is
 * disabled. Never throws: a Discord failure must not fail the decision.
 */
async function syncDiscordOnDecision(
  requestId: string,
  action: ApprovalAction,
  adminUserId: string
): Promise<void> {
  try {
    const { getDiscordBotService } = await import('./discord/discord-bot.service');
    if (!getDiscordBotService().getClient()) {
      logger.info('Skipping Discord decision sync: bot not running', { requestId });
      return;
    }

    // The Discord handler passes `discord:<id>` when an admin-role holder has no linked RMAB
    // account; otherwise resolve the deciding user's linked Discord account. Either may be absent,
    // in which case the decision renders without a "by" mention.
    let mentionId: string | null = null;
    if (adminUserId.startsWith('discord:')) {
      mentionId = adminUserId.slice('discord:'.length);
    } else {
      const actor = await prisma.user.findUnique({
        where: { id: adminUserId },
        select: { discordUserId: true },
      });
      mentionId = actor?.discordUserId ?? null;
    }

    const { applyDecisionToApprovalMessage, editRequestCards, notifyRequesterOfDecision } =
      await import('./discord/discord-cards');

    await applyDecisionToApprovalMessage(requestId, action, mentionId);
    await editRequestCards(requestId);
    await notifyRequesterOfDecision(requestId, action);
  } catch (error) {
    logger.warn('Could not sync Discord surfaces for decision', {
      requestId,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Process an approve/deny action for a request awaiting approval.
 *
 * Behavior mirrors the original inline route logic exactly:
 * - approve + effective torrent (admin-selected or user pre-selected) → start download directly
 *   (Anna's Archive ebooks via direct-download job, otherwise standard download job).
 * - approve without a torrent → set status 'pending' and trigger the appropriate search job.
 * - deny → set status 'denied' (no notification).
 */
export async function processRequestApproval(
  input: ProcessApprovalInput
): Promise<ApprovalResult> {
  const { requestId: id, action, adminUserId, selectedTorrent: adminSelectedTorrent } = input;

  try {
    // Fetch the request
    // findFirst (not findUnique) so the query can filter on deletedAt. Soft delete intentionally
    // leaves `status` untouched, so a cancelled request would otherwise still match
    // 'awaiting_approval' and get approved, enqueuing a real download for a deleted request.
    const existingRequest = await prisma.request.findFirst({
      where: { id, deletedAt: null },
      include: {
        audiobook: true,
        user: {
          select: {
            id: true,
            plexUsername: true,
          },
        },
      },
    });

    if (!existingRequest) {
      return { success: false, reason: 'not_found', message: 'Request not found' };
    }

    // Validate request is in 'awaiting_approval' status
    if (existingRequest.status !== 'awaiting_approval') {
      return {
        success: false,
        reason: 'invalid_status',
        message: `Request is not awaiting approval (current status: ${existingRequest.status})`,
        currentStatus: existingRequest.status,
      };
    }

    const jobQueue = getJobQueueService();
    const isEbookRequest = existingRequest.type === 'ebook';
    const requestType = isEbookRequest ? 'ebook' : 'audiobook';

    // Update request based on action
    if (action === 'approve') {
      // Use admin-provided torrent (from admin interactive search) or fall back to user's pre-selected torrent
      const effectiveTorrent = adminSelectedTorrent || existingRequest.selectedTorrent;

      // Atomically claim the transition out of 'awaiting_approval' BEFORE enqueuing any jobs, so two
      // concurrent approvals (e.g. the Discord Approve button and the Web UI, or two admins) can't
      // both pass the status check and double-enqueue download/search jobs + notifications. Only the
      // actor whose conditional update actually flips the row proceeds; the loser bails as stale.
      const claim = await prisma.request.updateMany({
        where: { id, status: 'awaiting_approval', deletedAt: null },
        data: effectiveTorrent
          ? { status: 'downloading', selectedTorrent: null as any }
          : { status: 'pending' },
      });
      if (claim.count === 0) {
        return staleStatusResult(id);
      }

      if (effectiveTorrent) {
        const selectedTorrent = effectiveTorrent as any;
        const torrentSource = adminSelectedTorrent ? 'admin' : 'user';

        // Download the selected torrent directly
        logger.info(`Request ${id} has ${torrentSource}-selected torrent, starting download`, {
          requestId: id,
          userId: existingRequest.userId,
          adminId: adminUserId,
          type: existingRequest.type,
          source: selectedTorrent.source,
        });

        // The claim above already flipped the row, so an enqueue failure past this point would
        // strand the request with no job to advance it. Roll the claim back and let the admin retry.
        try {
          // Handle ebook requests with Anna's Archive source differently
          if (isEbookRequest && selectedTorrent.source === 'annas_archive') {
            // Create download history record for Anna's Archive
            const downloadHistory = await prisma.downloadHistory.create({
              data: {
                requestId: existingRequest.id,
                indexerName: "Anna's Archive",
                torrentName: `${existingRequest.audiobook.title} - ${existingRequest.audiobook.author}.${selectedTorrent.format || 'epub'}`,
                torrentSizeBytes: null,
                qualityScore: selectedTorrent.score || 100,
                selected: true,
                downloadClient: 'direct',
                downloadStatus: 'queued',
              },
            });

            // Store all download URLs for retry purposes
            if (selectedTorrent.downloadUrls && selectedTorrent.downloadUrls.length > 0) {
              await prisma.downloadHistory.update({
                where: { id: downloadHistory.id },
                data: {
                  torrentUrl: JSON.stringify(selectedTorrent.downloadUrls),
                },
              });
            }

            // Trigger direct download job for Anna's Archive
            await jobQueue.addStartDirectDownloadJob(
              existingRequest.id,
              downloadHistory.id,
              selectedTorrent.downloadUrl,
              `${existingRequest.audiobook.title} - ${existingRequest.audiobook.author}.${selectedTorrent.format || 'epub'}`,
              undefined
            );
          } else {
            // Trigger download job with pre-selected torrent (audiobook or indexer ebook)
            await jobQueue.addDownloadJob(
              existingRequest.id,
              {
                id: existingRequest.audiobook.id,
                title: existingRequest.audiobook.title,
                author: existingRequest.audiobook.author,
              },
              selectedTorrent
            );
          }
        } catch (enqueueError) {
          await releaseClaim(id, 'downloading', existingRequest.selectedTorrent);
          logger.error(`Failed to enqueue download for request ${id}; rolled back to awaiting_approval`, {
            requestId: id,
            adminId: adminUserId,
            error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
          });
          return {
            success: false,
            reason: 'error',
            message: 'Failed to start the download. The request is still awaiting approval; please try again.',
          };
        }

        // The atomic claim already flipped the row to 'downloading' and cleared selectedTorrent;
        // derive the updated view from the data we already read (no extra round-trip needed).
        const updatedRequest = { ...existingRequest, status: 'downloading', selectedTorrent: null };

        // Send notification for manual approval
        await jobQueue.addNotificationJob(
          'request_approved',
          updatedRequest.id,
          isEbookRequest ? `${existingRequest.audiobook.title} (Ebook)` : existingRequest.audiobook.title,
          existingRequest.audiobook.author,
          existingRequest.user.plexUsername || 'Unknown User',
          undefined,
          requestType
        ).catch((error) => {
          logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
        });

        logger.info(`Request ${id} approved by admin ${adminUserId}, downloading ${torrentSource}-selected torrent`, {
          requestId: id,
          userId: updatedRequest.userId,
          audiobookTitle: existingRequest.audiobook.title,
          adminId: adminUserId,
          type: existingRequest.type,
          torrentSource,
        });

        await syncDiscordOnDecision(id, 'approve', adminUserId);

        return {
          success: true,
          message: adminSelectedTorrent
            ? 'Request approved and download started with admin-selected torrent'
            : 'Request approved and download started with pre-selected torrent',
          request: updatedRequest,
        };
      } else {
        // No pre-selected torrent - use automatic search
        logger.info(`Request ${id} using automatic search`, {
          requestId: id,
          userId: existingRequest.userId,
          adminId: adminUserId,
          type: existingRequest.type,
        });

        // The atomic claim already flipped the row to 'pending'; derive the updated view.
        const updatedRequest = { ...existingRequest, status: 'pending' };

        // The claim above already flipped the row, so an enqueue failure past this point would
        // strand the request with no job to advance it. Roll the claim back and let the admin retry.
        try {
          // Trigger appropriate search job based on request type
          if (isEbookRequest) {
            await jobQueue.addSearchEbookJob(updatedRequest.id, {
              id: updatedRequest.audiobook.id,
              title: updatedRequest.audiobook.title,
              author: updatedRequest.audiobook.author,
              asin: updatedRequest.audiobook.audibleAsin || undefined,
            });
          } else {
            await jobQueue.addSearchJob(updatedRequest.id, {
              id: updatedRequest.audiobook.id,
              title: updatedRequest.audiobook.title,
              author: updatedRequest.audiobook.author,
              asin: updatedRequest.audiobook.audibleAsin || undefined,
            });
          }
        } catch (enqueueError) {
          await releaseClaim(id, 'pending', existingRequest.selectedTorrent);
          logger.error(`Failed to enqueue search for request ${id}; rolled back to awaiting_approval`, {
            requestId: id,
            adminId: adminUserId,
            error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
          });
          return {
            success: false,
            reason: 'error',
            message: 'Failed to start the search. The request is still awaiting approval; please try again.',
          };
        }

        // Send notification for manual approval
        await jobQueue.addNotificationJob(
          'request_approved',
          updatedRequest.id,
          isEbookRequest ? `${updatedRequest.audiobook.title} (Ebook)` : updatedRequest.audiobook.title,
          updatedRequest.audiobook.author,
          updatedRequest.user.plexUsername || 'Unknown User',
          undefined,
          requestType
        ).catch((error) => {
          logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
        });

        logger.info(`Request ${id} approved by admin ${adminUserId}`, {
          requestId: id,
          userId: updatedRequest.userId,
          audiobookTitle: updatedRequest.audiobook.title,
          adminId: adminUserId,
          type: existingRequest.type,
        });

        await syncDiscordOnDecision(id, 'approve', adminUserId);

        return {
          success: true,
          message: isEbookRequest
            ? 'Ebook request approved and ebook search job triggered'
            : 'Request approved and search job triggered',
          request: updatedRequest,
        };
      }
    } else {
      // Deny: atomically claim the transition to 'denied' so a concurrent approve/deny can't both
      // act on the same request.
      const claim = await prisma.request.updateMany({
        where: { id, status: 'awaiting_approval', deletedAt: null },
        data: { status: 'denied' },
      });
      if (claim.count === 0) {
        return staleStatusResult(id);
      }

      const updatedRequest = { ...existingRequest, status: 'denied' };

      logger.info(`Request ${id} denied by admin ${adminUserId}`, {
        requestId: id,
        userId: updatedRequest.userId,
        audiobookTitle: updatedRequest.audiobook.title,
        adminId: adminUserId,
      });

      await syncDiscordOnDecision(id, 'deny', adminUserId);

      return {
        success: true,
        message: 'Request denied',
        request: updatedRequest,
      };
    }
  } catch (error) {
    logger.error('Failed to process approval action', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      reason: 'error',
      message: 'Failed to process approval action',
    };
  }
}
