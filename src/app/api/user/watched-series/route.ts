/**
 * Component: Watched Series API Routes
 * Documentation: documentation/features/watched-lists.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { z } from 'zod';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.WatchedSeries');

const AddWatchedSeriesSchema = z.object({
  seriesAsin: z.string().regex(/^[A-Z0-9]{10}$/, 'Invalid series ASIN'),
  seriesTitle: z.string().min(1).max(500),
  coverArtUrl: z.string().url().optional(),
});

/**
 * GET /api/user/watched-series
 * List the current user's watched series
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const series = await prisma.watchedSeries.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
      });

      return NextResponse.json({
        success: true,
        series: series.map((s) => ({
          id: s.id,
          seriesAsin: s.seriesAsin,
          seriesTitle: s.seriesTitle,
          coverArtUrl: s.coverArtUrl,
          lastCheckedAt: s.lastCheckedAt,
          createdAt: s.createdAt,
        })),
      });
    } catch (error) {
      logger.error('Failed to list watched series', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'Failed to list watched series' }, { status: 500 });
    }
  });
}

/**
 * POST /api/user/watched-series
 * Add a series to the user's watch list
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const body = await req.json();
      const { seriesAsin, seriesTitle, coverArtUrl } = AddWatchedSeriesSchema.parse(body);

      // Check for duplicate
      const existing = await prisma.watchedSeries.findUnique({
        where: { userId_seriesAsin: { userId: req.user.id, seriesAsin } },
      });

      if (existing) {
        return NextResponse.json(
          { error: 'AlreadyWatching', message: 'You are already watching this series' },
          { status: 409 }
        );
      }

      const watched = await prisma.watchedSeries.create({
        data: {
          userId: req.user.id,
          seriesAsin,
          seriesTitle,
          coverArtUrl: coverArtUrl || null,
        },
      });

      logger.info(`User ${req.user.id} started watching series "${seriesTitle}" (${seriesAsin})`);

      // Trigger immediate targeted check for this series (fire-and-forget)
      try {
        const jobQueue = getJobQueueService();
        await jobQueue.addCheckWatchedItemJob(req.user.id, seriesAsin);
        logger.info(`Triggered immediate check for watched series "${seriesTitle}" (${seriesAsin})`);
      } catch (error) {
        logger.error('Failed to trigger immediate watched series check', { error: error instanceof Error ? error.message : String(error) });
      }

      return NextResponse.json({
        success: true,
        series: {
          id: watched.id,
          seriesAsin: watched.seriesAsin,
          seriesTitle: watched.seriesTitle,
          coverArtUrl: watched.coverArtUrl,
          lastCheckedAt: watched.lastCheckedAt,
          createdAt: watched.createdAt,
        },
      }, { status: 201 });
    } catch (error) {
      logger.error('Failed to add watched series', { error: error instanceof Error ? error.message : String(error) });

      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'ValidationError', details: error.errors },
          { status: 400 }
        );
      }

      return NextResponse.json({ error: 'Failed to add watched series' }, { status: 500 });
    }
  });
}
