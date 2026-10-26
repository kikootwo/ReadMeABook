/**
 * Component: Ignored Audiobooks API Routes
 * Documentation: documentation/features/ignored-audiobooks.md
 *
 * Per-user ignore list for auto-request suppression.
 * GET returns the user's full ignore list; POST adds a new entry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.IgnoredAudiobooks');

const AddIgnoredSchema = z.object({
  asin: z.string().min(1).max(20),
  title: z.string().min(1).max(500),
  author: z.string().min(1).max(500),
  coverArtUrl: z.string().optional(),
});

/**
 * GET /api/user/ignored-audiobooks
 * List the current user's ignored audiobooks
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const ignored = await prisma.ignoredAudiobook.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
      });

      return NextResponse.json({
        success: true,
        ignoredAudiobooks: ignored.map((item) => ({
          id: item.id,
          asin: item.asin,
          title: item.title,
          author: item.author,
          coverArtUrl: item.coverArtUrl,
          createdAt: item.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      logger.error('Failed to list ignored audiobooks', {
        error: errorForLog(error),
      });
      return NextResponse.json(
        { error: 'FetchError', message: 'Failed to fetch ignored audiobooks' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/user/ignored-audiobooks
 * Add an audiobook to the user's ignore list
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const body = await req.json();
      const data = AddIgnoredSchema.parse(body);

      // Upsert to handle duplicate gracefully
      const ignored = await prisma.ignoredAudiobook.upsert({
        where: {
          userId_asin: { userId: req.user.id, asin: data.asin },
        },
        update: {}, // Already exists — no-op
        create: {
          userId: req.user.id,
          asin: data.asin,
          title: data.title,
          author: data.author,
          coverArtUrl: data.coverArtUrl,
        },
      });

      logger.info(`User ${req.user.id} ignored ASIN ${data.asin} ("${data.title}")`);

      return NextResponse.json({
        success: true,
        ignoredAudiobook: {
          id: ignored.id,
          asin: ignored.asin,
          title: ignored.title,
          author: ignored.author,
          coverArtUrl: ignored.coverArtUrl,
          createdAt: ignored.createdAt.toISOString(),
        },
      }, { status: 201 });
    } catch (error) {
      logger.error('Failed to add ignored audiobook', {
        error: errorForLog(error),
      });

      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'ValidationError', details: zodIssueDetails(error) },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: 'CreateError', message: 'Failed to ignore audiobook' },
        { status: 500 }
      );
    }
  });
}
