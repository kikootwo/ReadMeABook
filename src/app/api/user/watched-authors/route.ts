/**
 * Component: Watched Authors API Routes
 * Documentation: documentation/features/watched-lists.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { z } from 'zod';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.WatchedAuthors');

const AddWatchedAuthorSchema = z.object({
  authorAsin: z.string().regex(/^[A-Z0-9]{10}$/, 'Invalid author ASIN'),
  authorName: z.string().min(1).max(500),
  coverArtUrl: z.string().url().optional(),
});

/**
 * GET /api/user/watched-authors
 * List the current user's watched authors
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const authors = await prisma.watchedAuthor.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
      });

      return NextResponse.json({
        success: true,
        authors: authors.map((a) => ({
          id: a.id,
          authorAsin: a.authorAsin,
          authorName: a.authorName,
          coverArtUrl: a.coverArtUrl,
          lastCheckedAt: a.lastCheckedAt,
          createdAt: a.createdAt,
        })),
      });
    } catch (error) {
      logger.error('Failed to list watched authors', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'Failed to list watched authors' }, { status: 500 });
    }
  });
}

/**
 * POST /api/user/watched-authors
 * Add an author to the user's watch list
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const body = await req.json();
      const { authorAsin, authorName, coverArtUrl } = AddWatchedAuthorSchema.parse(body);

      // Check for duplicate
      const existing = await prisma.watchedAuthor.findUnique({
        where: { userId_authorAsin: { userId: req.user.id, authorAsin } },
      });

      if (existing) {
        return NextResponse.json(
          { error: 'AlreadyWatching', message: 'You are already watching this author' },
          { status: 409 }
        );
      }

      const watched = await prisma.watchedAuthor.create({
        data: {
          userId: req.user.id,
          authorAsin,
          authorName,
          coverArtUrl: coverArtUrl || null,
        },
      });

      logger.info(`User ${req.user.id} started watching author "${authorName}" (${authorAsin})`);

      // Trigger immediate targeted check for this author (fire-and-forget)
      try {
        const jobQueue = getJobQueueService();
        await jobQueue.addCheckWatchedItemJob(req.user.id, undefined, authorAsin);
        logger.info(`Triggered immediate check for watched author "${authorName}" (${authorAsin})`);
      } catch (error) {
        logger.error('Failed to trigger immediate watched author check', { error: error instanceof Error ? error.message : String(error) });
      }

      return NextResponse.json({
        success: true,
        author: {
          id: watched.id,
          authorAsin: watched.authorAsin,
          authorName: watched.authorName,
          coverArtUrl: watched.coverArtUrl,
          lastCheckedAt: watched.lastCheckedAt,
          createdAt: watched.createdAt,
        },
      }, { status: 201 });
    } catch (error) {
      logger.error('Failed to add watched author', { error: error instanceof Error ? error.message : String(error) });

      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'ValidationError', details: error.errors },
          { status: 400 }
        );
      }

      return NextResponse.json({ error: 'Failed to add watched author' }, { status: 500 });
    }
  });
}
