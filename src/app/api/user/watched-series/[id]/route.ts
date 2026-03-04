/**
 * Component: Watched Series Delete Route
 * Documentation: documentation/features/watched-lists.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.WatchedSeries');

/**
 * DELETE /api/user/watched-series/[id]
 * Remove a series from the user's watch list (ownership check)
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

      const watched = await prisma.watchedSeries.findUnique({
        where: { id },
      });

      if (!watched) {
        return NextResponse.json({ error: 'Watched series not found' }, { status: 404 });
      }

      // Ownership check
      if (watched.userId !== req.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      await prisma.watchedSeries.delete({ where: { id } });

      logger.info(`User ${req.user.id} stopped watching series "${watched.seriesTitle}" (${watched.seriesAsin})`);

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Failed to delete watched series', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'Failed to delete watched series' }, { status: 500 });
    }
  });
}
