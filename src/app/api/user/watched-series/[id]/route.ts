/**
 * Component: Watched Series Item Routes (change mode, delete)
 * Documentation: documentation/features/watched-lists.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { readJsonBody } from '@/lib/utils/request-body';
import { nextNewReleasesSince, watchModeFields } from '@/lib/utils/watch-mode';

const logger = RMABLogger.create('API.WatchedSeries');

const UpdateWatchModeSchema = z.strictObject({
  /** true = new releases only (keeps an existing cutoff); false = entire catalog */
  newReleasesOnly: z.boolean(),
});

/**
 * PATCH /api/user/watched-series/[id]
 * Change a watch between entire catalog and new releases only (ownership check).
 * Switching to entire catalog requests the backlog on the next scheduled check; no job is queued here.
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
      const bodyResult = await readJsonBody(req);
      if (!bodyResult.ok) return bodyResult.response;
      const { newReleasesOnly } = UpdateWatchModeSchema.parse(bodyResult.data);

      const watched = await prisma.watchedSeries.findUnique({ where: { id } });
      if (!watched) {
        return NextResponse.json({ error: 'Watched series not found' }, { status: 404 });
      }
      if (watched.userId !== req.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const updated = await prisma.watchedSeries.update({
        where: { id },
        data: { newReleasesSince: nextNewReleasesSince(watched.newReleasesSince, newReleasesOnly) },
      });

      logger.info(`User ${req.user.id} set watched series "${watched.seriesTitle}" (${watched.seriesAsin}) to ${newReleasesOnly ? 'new releases only' : 'entire catalog'}`);

      return NextResponse.json({
        success: true,
        series: {
          id: updated.id,
          seriesAsin: updated.seriesAsin,
          seriesTitle: updated.seriesTitle,
          coverArtUrl: updated.coverArtUrl,
          lastCheckedAt: updated.lastCheckedAt,
          ...watchModeFields(updated),
          createdAt: updated.createdAt,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'ValidationError', details: zodIssueDetails(error) },
          { status: 400 }
        );
      }
      logger.error('Failed to update watched series', { error: errorForLog(error) });
      return NextResponse.json({ error: 'Failed to update watched series' }, { status: 500 });
    }
  });
}

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
