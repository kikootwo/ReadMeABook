/**
 * Component: Watched Author Item Route
 * Documentation: documentation/features/watched-lists.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { z } from 'zod';

const logger = RMABLogger.create('API.WatchedAuthors');
const UpdateWatchedAuthorSchema = z.object({ includeBackCatalog: z.boolean() });

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
      const { includeBackCatalog } = UpdateWatchedAuthorSchema.parse(await req.json());
      const watched = await prisma.watchedAuthor.findUnique({ where: { id } });

      if (!watched) {
        return NextResponse.json({ error: 'Watched author not found' }, { status: 404 });
      }
      if (watched.userId !== req.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const updated = await prisma.watchedAuthor.update({
        where: { id },
        data: { includeBackCatalog },
      });

      if (includeBackCatalog && !watched.includeBackCatalog) {
        try {
          await getJobQueueService().addCheckWatchedItemJob(req.user.id, undefined, watched.authorAsin);
        } catch (error) {
          logger.error('Failed to trigger watched author check', { error: error instanceof Error ? error.message : String(error) });
        }
      }

      return NextResponse.json({ success: true, author: updated });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'ValidationError', details: error.errors }, { status: 400 });
      }
      logger.error('Failed to update watched author', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'Failed to update watched author' }, { status: 500 });
    }
  });
}

/**
 * DELETE /api/user/watched-authors/[id]
 * Remove an author from the user's watch list (ownership check)
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

      const watched = await prisma.watchedAuthor.findUnique({
        where: { id },
      });

      if (!watched) {
        return NextResponse.json({ error: 'Watched author not found' }, { status: 404 });
      }

      // Ownership check
      if (watched.userId !== req.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      await prisma.watchedAuthor.delete({ where: { id } });

      logger.info(`User ${req.user.id} stopped watching author "${watched.authorName}" (${watched.authorAsin})`);

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Failed to delete watched author', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'Failed to delete watched author' }, { status: 500 });
    }
  });
}
