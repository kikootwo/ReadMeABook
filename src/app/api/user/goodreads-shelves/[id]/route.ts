/**
 * Component: Goodreads Shelf Delete Route
 * Documentation: documentation/backend/services/goodreads-sync.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { z } from 'zod';

const logger = RMABLogger.create('API.GoodreadsShelves');

const UpdateGoodreadsSchema = z.object({
  rssUrl: z.string().url('Must be a valid URL'),
});

/**
 * DELETE /api/user/goodreads-shelves/[id]
 * Remove a Goodreads shelf subscription (ownership check)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { id } = await params;

      const shelf = await prisma.goodreadsShelf.findUnique({
        where: { id },
      });

      if (!shelf) {
        return NextResponse.json({ error: 'Shelf not found' }, { status: 404 });
      }

      // Ownership check
      if (shelf.userId !== req.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      await prisma.goodreadsShelf.delete({ where: { id } });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Failed to delete shelf', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'Failed to delete shelf' }, { status: 500 });
    }
  });
}

/**
 * PATCH /api/user/goodreads-shelves/[id]
 * Update a Goodreads shelf subscription
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { id } = await params;
      const shelf = await prisma.goodreadsShelf.findUnique({ where: { id } });

      if (!shelf) {
        return NextResponse.json({ error: 'Shelf not found' }, { status: 404 });
      }

      if (shelf.userId !== req.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const body = await request.json();
      const { rssUrl } = UpdateGoodreadsSchema.parse(body);

      // Force re-fetch by clearing metadata
      const updated = await prisma.goodreadsShelf.update({
        where: { id },
        data: { rssUrl, lastSyncAt: null, bookCount: null, coverUrls: null },
      });

      try {
        const jobQueue = getJobQueueService();
        await jobQueue.addSyncShelvesJob(undefined, updated.id, 'goodreads', 0);
      } catch (error) {
        logger.error('Failed to trigger immediate list sync', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return NextResponse.json({ success: true, shelf: updated });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'ValidationError', details: error.errors }, { status: 400 });
      }
      logger.error('Failed to update shelf', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'Failed to update shelf' }, { status: 500 });
    }
  });
}
