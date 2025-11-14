/**
 * Component: Select Torrent API
 * Documentation: documentation/phase3/prowlarr.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { TorrentResult } from '@/lib/utils/ranking-algorithm';

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

      const { id } = await params;
      const body = await req.json();
      const { torrent } = body as { torrent: TorrentResult };

      if (!torrent) {
        return NextResponse.json(
          { error: 'ValidationError', message: 'Torrent data is required' },
          { status: 400 }
        );
      }

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

      console.log(`[SelectTorrent] User selected torrent: ${torrent.title} for request ${id}`);

      // Trigger download job with the selected torrent
      const jobQueue = getJobQueueService();
      await jobQueue.addDownloadJob(
        id,
        {
          id: requestRecord.audiobook.id,
          title: requestRecord.audiobook.title,
          author: requestRecord.audiobook.author,
        },
        torrent
      );

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
        request: updated,
        message: 'Torrent download initiated',
      });
    } catch (error) {
      console.error('Failed to select torrent:', error);
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
