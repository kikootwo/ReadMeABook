/**
 * Component: Individual Request API Routes
 * Documentation: documentation/backend/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { CLIENT_PROTOCOL_MAP, DownloadClientType } from '@/lib/interfaces/download-client.interface';

const logger = RMABLogger.create('API.RequestById');

/**
 * GET /api/requests/[id]
 * Get a specific request by ID
 */
export async function GET(
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

      const { id } = await params;

      const requestRecord = await prisma.request.findFirst({
        where: {
          id,
          deletedAt: null, // Only show active requests
        },
        include: {
          audiobook: true,
          user: {
            select: {
              id: true,
              plexUsername: true,
            },
          },
          downloadHistory: {
            where: { selected: true },
            take: 1,
          },
          jobs: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });

      if (!requestRecord) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Request not found' },
          { status: 404 }
        );
      }

      // Check authorization: users can only see their own requests, admins can see all
      if (requestRecord.userId !== req.user.id && req.user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'You do not have access to this request' },
          { status: 403 }
        );
      }

      return NextResponse.json({
        success: true,
        request: requestRecord,
      });
    } catch (error) {
      logger.error('Failed to get request', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        {
          error: 'FetchError',
          message: 'Failed to fetch request',
        },
        { status: 500 }
      );
    }
  });
}

/**
 * PATCH /api/requests/[id]
 * Update a request (cancel, retry, etc.)
 */
export async function PATCH(
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

      const { id } = await params;
      const body = await req.json();
      const { action } = body;

      const requestRecord = await prisma.request.findFirst({
        where: {
          id,
          deletedAt: null, // Only allow updates to active requests
        },
        include: {
          audiobook: true,
          user: { select: { plexUsername: true } },
        },
      });

      if (!requestRecord) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Request not found or already deleted' },
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

      if (action === 'cancel') {
        const cancellableStatuses = ['pending', 'searching', 'downloading', 'awaiting_search', 'awaiting_approval'];
        if (!cancellableStatuses.includes(requestRecord.status)) {
          return NextResponse.json(
            {
              error: 'ValidationError',
              message: `Cannot cancel request with status: ${requestRecord.status}`,
            },
            { status: 400 }
          );
        }

        const isAwaitingApproval = requestRecord.status === 'awaiting_approval';

        const updated = await prisma.request.update({
          where: { id },
          data: {
            status: 'cancelled',
            updatedAt: new Date(),
            ...(isAwaitingApproval && { selectedTorrent: null as any }),
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

        return NextResponse.json({
          success: true,
          request: updated,
          message: 'Request cancelled successfully',
        });
      } else if (action === 'retry') {
        // Retry failed request - allow users to retry their own warn/failed requests
        // Only allow retry for failed, warn, or awaiting_* statuses
        const retryableStatuses = ['failed', 'warn', 'awaiting_search', 'awaiting_import'];

        if (!retryableStatuses.includes(requestRecord.status)) {
          return NextResponse.json(
            {
              error: 'ValidationError',
              message: `Cannot retry request with status: ${requestRecord.status}`,
            },
            { status: 400 }
          );
        }

        // Determine which job to trigger based on the current status
        const { getJobQueueService } = await import('@/lib/services/job-queue.service');
        const jobQueue = getJobQueueService();

        let jobType: string;
        let updated;

        if (requestRecord.status === 'warn' || requestRecord.status === 'awaiting_import') {
          // Retry import
          const requestWithData = await prisma.request.findFirst({
            where: {
              id,
              deletedAt: null,
            },
            include: {
              audiobook: true,
              downloadHistory: {
                where: { selected: true },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          });

          if (!requestWithData || !requestWithData.downloadHistory[0]) {
            return NextResponse.json(
              {
                error: 'ValidationError',
                message: 'No download history found, cannot retry import',
              },
              { status: 400 }
            );
          }

          const downloadHistory = requestWithData.downloadHistory[0];

          // Get download path from the appropriate download client
          let downloadPath: string;

          // Get download path via unified interface
          const clientId = downloadHistory.downloadClientId || downloadHistory.torrentHash || downloadHistory.nzbId;
          const clientType = downloadHistory.downloadClient || 'qbittorrent';

          if (!clientId || clientType === 'direct') {
            return NextResponse.json(
              {
                error: 'ValidationError',
                message: 'No download client ID found in history',
              },
              { status: 400 }
            );
          }

          const { getConfigService } = await import('@/lib/services/config.service');
          const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
          const configService = getConfigService();
          const manager = getDownloadClientManager(configService);
          const protocol = CLIENT_PROTOCOL_MAP[clientType as DownloadClientType] || 'torrent';
          const client = await manager.getClientServiceForProtocol(protocol as 'torrent' | 'usenet');

          if (!client) {
            return NextResponse.json(
              {
                error: 'ValidationError',
                message: `No ${clientType} client configured`,
              },
              { status: 400 }
            );
          }

          const info = await client.getDownload(clientId);
          if (!info?.downloadPath) {
            return NextResponse.json(
              {
                error: 'ValidationError',
                message: `Download path not available from ${client.clientType}`,
              },
              { status: 400 }
            );
          }
          downloadPath = info.downloadPath;

          await jobQueue.addOrganizeJob(
            id,
            requestWithData.audiobook.id,
            downloadPath
          );

          updated = await prisma.request.update({
            where: { id },
            data: {
              status: 'processing',
              progress: 100,
              errorMessage: null,
              updatedAt: new Date(),
            },
            include: {
              audiobook: true,
            },
          });

          jobType = 'import';
        } else {
          // Retry search
          const requestWithData = await prisma.request.findFirst({
            where: {
              id,
              deletedAt: null,
            },
            include: {
              audiobook: true,
            },
          });

          if (!requestWithData) {
            return NextResponse.json(
              { error: 'NotFound', message: 'Request not found' },
              { status: 404 }
            );
          }

          await jobQueue.addSearchJob(id, {
            id: requestWithData.audiobook.id,
            title: requestWithData.audiobook.title,
            author: requestWithData.audiobook.author,
            asin: requestWithData.audiobook.audibleAsin || undefined,
          });

          updated = await prisma.request.update({
            where: { id },
            data: {
              status: 'pending',
              progress: 0,
              errorMessage: null,
              updatedAt: new Date(),
            },
            include: {
              audiobook: true,
            },
          });

          jobType = 'search';
        }

        return NextResponse.json({
          success: true,
          request: updated,
          message: `Request retry initiated (${jobType})`,
        });
      }

      return NextResponse.json(
        {
          error: 'ValidationError',
          message: 'Invalid action',
        },
        { status: 400 }
      );
    } catch (error) {
      logger.error('Failed to update request', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        {
          error: 'UpdateError',
          message: 'Failed to update request',
        },
        { status: 500 }
      );
    }
  });
}

/**
 * DELETE /api/requests/[id]
 * Delete a request (admin only)
 */
export async function DELETE(
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

      if (req.user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'Admin access required' },
          { status: 403 }
        );
      }

      const { id } = await params;

      await prisma.request.delete({
        where: { id },
      });

      return NextResponse.json({
        success: true,
        message: 'Request deleted successfully',
      });
    } catch (error) {
      logger.error('Failed to delete request', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        {
          error: 'DeleteError',
          message: 'Failed to delete request',
        },
        { status: 500 }
      );
    }
  });
}
