/**
 * Component: Goodreads Shelves API Routes
 * Documentation: documentation/backend/services/goodreads-sync.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { fetchAndValidateRss } from '@/lib/services/goodreads-sync.service';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { z } from 'zod';
import { RMABLogger } from '@/lib/utils/logger';
import { goodreadsRssUrlSchema } from '@/lib/utils/goodreads-rss-url.schema';
import { DUPLICATE_SHELF_MESSAGE, findShelfWithSameFeed, isUniqueConstraintError } from '@/lib/services/goodreads-shelf-match';

const logger = RMABLogger.create('API.GoodreadsShelves');

const AddShelfSchema = z.object({
  rssUrl: goodreadsRssUrlSchema,
  autoRequest: z.boolean().optional().default(true),
});

/**
 * GET /api/user/goodreads-shelves
 * List the current user's Goodreads shelves with book counts and covers
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const shelves = await prisma.goodreadsShelf.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
      });

      const shelvesWithMeta = shelves.map((shelf) => {
        // Normalize coverUrls: old format (string[]) → new format ({coverUrl,asin,title,author}[])
        let books: { coverUrl: string; asin: string | null; title: string; author: string }[] = [];
        if (shelf.coverUrls) {
          const parsed = JSON.parse(shelf.coverUrls);
          if (Array.isArray(parsed)) {
            books = parsed.map((item: unknown) => {
              if (typeof item === 'string') {
                return { coverUrl: item, asin: null, title: '', author: '' };
              }
              const obj = item as Record<string, unknown>;
              return {
                coverUrl: (obj.coverUrl as string) || '',
                asin: (obj.asin as string) || null,
                title: (obj.title as string) || '',
                author: (obj.author as string) || '',
              };
            });
          }
        }

        return {
          id: shelf.id,
          name: shelf.name,
          rssUrl: shelf.rssUrl,
          lastSyncAt: shelf.lastSyncAt,
          createdAt: shelf.createdAt,
          bookCount: shelf.bookCount ?? null,
          autoRequest: shelf.autoRequest,
          books,
        };
      });

      return NextResponse.json({ success: true, shelves: shelvesWithMeta });
    } catch (error) {
      logger.error('Failed to list shelves', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'Failed to list shelves' }, { status: 500 });
    }
  });
}

/**
 * POST /api/user/goodreads-shelves
 * Add a new Goodreads shelf subscription
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const body = await req.json();
      const { rssUrl, autoRequest } = AddShelfSchema.parse(body);

      // Check for duplicate (compares normalised feed URLs, so older http/bare-host rows match)
      const existing = await findShelfWithSameFeed(req.user.id, rssUrl);

      if (existing) {
        return NextResponse.json(
          { error: 'DuplicateShelf', message: DUPLICATE_SHELF_MESSAGE },
          { status: 409 }
        );
      }

      // Validate by fetching the RSS feed
      let shelfName: string;
      let bookCount: number;
      let initialBooks: { coverUrl: string; asin: null; title: string; author: string }[] = [];
      try {
        const rssData = await fetchAndValidateRss(rssUrl);
        shelfName = rssData.shelfName;
        bookCount = rssData.books.length;
        initialBooks = rssData.books
          .filter(b => b.coverUrl)
          .slice(0, 8)
          .map(b => ({ coverUrl: b.coverUrl!, asin: null, title: b.title, author: b.author }));
      } catch (error) {
        return NextResponse.json(
          {
            error: 'InvalidRSS',
            message: `Could not fetch or parse the RSS feed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
          { status: 400 }
        );
      }

      const shelf = await prisma.goodreadsShelf.create({
        data: {
          userId: req.user.id,
          name: shelfName,
          rssUrl,
          bookCount,
          autoRequest,
          coverUrls: initialBooks.length > 0 ? JSON.stringify(initialBooks) : null,
        },
      });

      // Trigger immediate sync for this shelf (unlimited lookups, process all books)
      try {
        const jobQueue = getJobQueueService();
        await jobQueue.addSyncShelvesJob(undefined, shelf.id, 'goodreads', 0, req.user.id);
        logger.info(`Triggered immediate sync for Goodreads shelf "${shelfName}" (${shelf.id})`);
      } catch (error) {
        logger.error('Failed to trigger immediate shelf sync', { error: error instanceof Error ? error.message : String(error) });
      }

      return NextResponse.json({
        success: true,
        shelf: {
          id: shelf.id,
          name: shelf.name,
          rssUrl: shelf.rssUrl,
          lastSyncAt: shelf.lastSyncAt,
          createdAt: shelf.createdAt,
          bookCount: shelf.bookCount,
          autoRequest: shelf.autoRequest,
          books: initialBooks,
        },
        bookCount,
      }, { status: 201 });
    } catch (error) {
      logger.error('Failed to add shelf', { error: error instanceof Error ? error.message : String(error) });

      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'ValidationError', message: error.errors[0]?.message, details: error.errors },
          { status: 400 }
        );
      }

      if (isUniqueConstraintError(error)) {
        return NextResponse.json({ error: 'DuplicateShelf', message: DUPLICATE_SHELF_MESSAGE }, { status: 409 });
      }

      return NextResponse.json({ error: 'Failed to add shelf' }, { status: 500 });
    }
  });
}
