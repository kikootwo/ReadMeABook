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
    const existingRequest = await prisma.request.findUnique({
      where: { id },
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

    // Update request based on action
    if (action === 'approve') {
      const jobQueue = getJobQueueService();
      const isEbookRequest = existingRequest.type === 'ebook';

      // Use admin-provided torrent (from admin interactive search) or fall back to user's pre-selected torrent
      const effectiveTorrent = adminSelectedTorrent || existingRequest.selectedTorrent;

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

        // Update status to 'downloading' and clear selectedTorrent
        const updatedRequest = await prisma.request.update({
          where: { id },
          data: {
            status: 'downloading',
            selectedTorrent: null as any, // Clear after use
          },
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

        // Send notification for manual approval
        await jobQueue.addNotificationJob(
          'request_approved',
          updatedRequest.id,
          isEbookRequest ? `${existingRequest.audiobook.title} (Ebook)` : existingRequest.audiobook.title,
          existingRequest.audiobook.author,
          existingRequest.user.plexUsername || 'Unknown User'
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

        const updatedRequest = await prisma.request.update({
          where: { id },
          data: { status: 'pending' },
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

        // Send notification for manual approval
        await jobQueue.addNotificationJob(
          'request_approved',
          updatedRequest.id,
          isEbookRequest ? `${updatedRequest.audiobook.title} (Ebook)` : updatedRequest.audiobook.title,
          updatedRequest.audiobook.author,
          updatedRequest.user.plexUsername || 'Unknown User'
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

        return {
          success: true,
          message: isEbookRequest
            ? 'Ebook request approved and ebook search job triggered'
            : 'Request approved and search job triggered',
          request: updatedRequest,
        };
      }
    } else {
      // Deny: Change status to 'denied'
      const updatedRequest = await prisma.request.update({
        where: { id },
        data: { status: 'denied' },
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

      logger.info(`Request ${id} denied by admin ${adminUserId}`, {
        requestId: id,
        userId: updatedRequest.userId,
        audiobookTitle: updatedRequest.audiobook.title,
        adminId: adminUserId,
      });

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
