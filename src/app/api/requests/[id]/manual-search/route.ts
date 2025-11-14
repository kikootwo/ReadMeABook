/**
 * Component: Manual Search API
 * Documentation: documentation/phase3/prowlarr.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';

/**
 * POST /api/requests/[id]/manual-search
 * Manually trigger a search for torrents
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

      const { id } = await params;

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

      // Only allow manual search for pending, failed, awaiting_search statuses
      const searchableStatuses = ['pending', 'failed', 'awaiting_search'];
      if (!searchableStatuses.includes(requestRecord.status)) {
        return NextResponse.json(
          {
            error: 'ValidationError',
            message: `Cannot manually search for request with status: ${requestRecord.status}`,
          },
          { status: 400 }
        );
      }

      // Trigger search job
      const jobQueue = getJobQueueService();
      await jobQueue.addSearchJob(id, {
        id: requestRecord.audiobook.id,
        title: requestRecord.audiobook.title,
        author: requestRecord.audiobook.author,
      });

      // Update request status
      const updated = await prisma.request.update({
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

      return NextResponse.json({
        success: true,
        request: updated,
        message: 'Manual search initiated',
      });
    } catch (error) {
      console.error('Failed to trigger manual search:', error);
      return NextResponse.json(
        {
          error: 'SearchError',
          message: 'Failed to initiate manual search',
        },
        { status: 500 }
      );
    }
  });
}
