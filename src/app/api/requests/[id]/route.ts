/**
 * Component: Individual Request API Routes
 * Documentation: documentation/backend/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

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

      const requestRecord = await prisma.request.findUnique({
        where: { id },
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
      console.error('Failed to get request:', error);
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

      const requestRecord = await prisma.request.findUnique({
        where: { id },
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

      if (action === 'cancel') {
        // Cancel the request
        const updated = await prisma.request.update({
          where: { id },
          data: {
            status: 'cancelled',
            updatedAt: new Date(),
          },
          include: {
            audiobook: true,
          },
        });

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
          const requestWithData = await prisma.request.findUnique({
            where: { id },
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

          // Get download path from qBittorrent
          const { getQBittorrentService } = await import('@/lib/integrations/qbittorrent.service');
          const qbt = await getQBittorrentService();
          const torrent = await qbt.getTorrent(downloadHistory.downloadClientId!);
          const downloadPath = `${torrent.save_path}/${torrent.name}`;

          await jobQueue.addOrganizeJob(
            id,
            requestWithData.audiobook.id,
            downloadPath,
            `/media/audiobooks/${requestWithData.audiobook.author}/${requestWithData.audiobook.title}`
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
          const requestWithData = await prisma.request.findUnique({
            where: { id },
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
      console.error('Failed to update request:', error);
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
      console.error('Failed to delete request:', error);
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
