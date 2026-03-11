/**
 * Component: Manual Shelf Sync API Route
 * Documentation: documentation/backend/services/goodreads-sync.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';
import { z } from 'zod';

const logger = RMABLogger.create('API.ShelvesSync');

const SyncSchema = z.object({
  shelfId: z.string().optional(),
  shelfType: z.enum(['goodreads', 'hardcover']).optional(),
});

/**
 * POST /api/user/shelves/sync
 * Trigger a manual sync for all or a specific shelf belonging to the user.
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const body = await request.json().catch(() => ({}));
      const { shelfId, shelfType } = SyncSchema.parse(body);

      // Set lastSyncAt to null so the frontend SWR refresh catches the "Syncing..." state immediately
      if (!shelfType || shelfType === 'goodreads') {
        await prisma.goodreadsShelf.updateMany({
          where: { userId: req.user.id, ...(shelfId ? { id: shelfId } : {}) },
          data: { lastSyncAt: null },
        });
      }

      if (!shelfType || shelfType === 'hardcover') {
        await prisma.hardcoverShelf.updateMany({
          where: { userId: req.user.id, ...(shelfId ? { id: shelfId } : {}) },
          data: { lastSyncAt: null },
        });
      }

      const jobQueue = getJobQueueService();

      // Trigger sync job with userId filter
      await jobQueue.addSyncShelvesJob(
        undefined,
        shelfId,
        shelfType,
        0, // unlimited lookups for manual trigger
        req.user.id
      );

      logger.info(`Manual sync triggered for user ${req.user.id}${shelfId ? ` (shelf: ${shelfId})` : ' (all shelves)'}`);

      return NextResponse.json({
        success: true,
        message: shelfId ? 'Shelf sync triggered' : 'All shelves sync triggered'
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'ValidationError', details: error.errors }, { status: 400 });
      }
      logger.error('Failed to trigger manual sync', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'Failed to trigger manual sync' },
        { status: 500 },
      );
    }
  });
}
