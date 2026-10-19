/**
 * Component: Select Torrent API
 * Documentation: documentation/phase3/prowlarr.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { TorrentResult } from '@/lib/utils/ranking-algorithm';
import { RMABLogger } from '@/lib/utils/logger';
import { denyWithoutInteractiveSearchAccess } from '@/lib/middleware/interactive-search-access';
import { guardTorrentSelection, rejectedSelectionResponse } from '@/lib/services/download-selection-guard';
import { hideStoredPick } from '@/lib/services/request-detail-query';

const logger = RMABLogger.create('API.SelectTorrent');

/**
 * POST /api/requests/[id]/select-torrent
 * Select and download a specific torrent from interactive search results
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const accessDenied = await denyWithoutInteractiveSearchAccess(req.user.id);
      if (accessDenied) return accessDenied;

      const { id } = await params;
      const body = await req.json();
      const { torrent: rawTorrent } = (body ?? {}) as { torrent?: TorrentResult };

      // Only magnet links or Prowlarr download links may be fetched on the user's behalf
      const torrentCheck = await guardTorrentSelection(rawTorrent);
      if (!torrentCheck.ok) return rejectedSelectionResponse(torrentCheck.error);
      const torrent = torrentCheck.value;

      const requestRecord = await prisma.request.findUnique({
        where: { id },
        include: {
          audiobook: true,
        },
      });

      if (!requestRecord) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Request not found' },
          { status: 404 }
        );
      }

      // Check authorization
      if (requestRecord.userId !== req.user.id && req.user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'You do not have access to this request' },
          { status: 403 }
        );
      }

      // Check if request is awaiting approval
      if (requestRecord.status === 'awaiting_approval') {
        return NextResponse.json(
          { error: 'AwaitingApproval', message: 'This request is awaiting admin approval. You cannot download torrents until it is approved.' },
          { status: 403 }
        );
      }

      // Re-check if approval is needed based on CURRENT settings (security: settings may have changed)
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          role: true,
          autoApproveRequests: true,
          plexUsername: true,
        },
      });

      if (!user) {
        return NextResponse.json(
          { error: 'UserNotFound', message: 'User not found' },
          { status: 404 }
        );
      }

      let needsApproval = false;

      // Determine if approval is needed (same logic as request creation)
      if (user.role === 'admin') {
        // Admins always auto-approve
        needsApproval = false;
      } else {
        // Check user's personal setting first
        if (user.autoApproveRequests === true) {
          needsApproval = false;
        } else if (user.autoApproveRequests === false) {
          needsApproval = true;
        } else {
          // User setting is null, check global setting
          const globalConfig = await prisma.configuration.findUnique({
            where: { key: 'auto_approve_requests' },
          });
          // Default to true if not configured (backward compatibility)
          const globalAutoApprove = globalConfig === null ? true : globalConfig.value === 'true';
          needsApproval = !globalAutoApprove;
        }
      }

      const jobQueue = getJobQueueService();

      // If approval is now needed, store torrent and wait for approval
      if (needsApproval) {
        logger.info(`Torrent selection requires approval`, { requestId: id, userId: req.user.id });

        const updated = await prisma.request.update({
          where: { id },
          data: {
            status: 'awaiting_approval',
            selectedTorrent: torrent as any, // Store the selected torrent
            updatedAt: new Date(),
          },
          include: {
            audiobook: true,
          },
        });

        // Send pending approval notification
        await jobQueue.addNotificationJob(
          'request_pending_approval',
          updated.id,
          requestRecord.audiobook.title,
          requestRecord.audiobook.author,
          user.plexUsername || 'Unknown User'
        ).catch((error) => {
          logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
        });

        logger.info(`Request ${id} stored selected torrent and awaits admin approval`);

        return NextResponse.json({
          success: true,
          request: hideStoredPick(updated, req.user.role),
          message: 'Request submitted for admin approval',
        });
      }

      // Auto-approved - start download immediately
      logger.info(`User selected torrent: ${torrent.title}`, { requestId: id });

      // Trigger download job with the selected torrent
      await jobQueue.addDownloadJob(
        id,
        {
          id: requestRecord.audiobook.id,
          title: requestRecord.audiobook.title,
          author: requestRecord.audiobook.author,
        },
        torrent
      );

      // Send approved notification (user has now committed to downloading)
      await jobQueue.addNotificationJob(
        'request_approved',
        id,
        requestRecord.audiobook.title,
        requestRecord.audiobook.author,
        user.plexUsername || 'Unknown User'
      ).catch((error) => {
        logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
      });

      // Update request status
      const updated = await prisma.request.update({
        where: { id },
        data: {
          status: 'downloading',
          progress: 0,
          errorMessage: null,
          updatedAt: new Date(),
        },
        include: {
          audiobook: true,
        },
      });

      return NextResponse.json({
        success: true,
        request: hideStoredPick(updated, req.user.role),
        message: 'Torrent download initiated',
      });
    } catch (error) {
      logger.error('Failed to select torrent', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        {
          error: 'DownloadError',
          message: error instanceof Error ? error.message : 'Failed to initiate torrent download',
        },
        { status: 500 }
      );
    }
  });
}
