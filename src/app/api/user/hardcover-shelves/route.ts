/**
 * Component: Hardcover Shelves API Routes
 * Documentation: documentation/backend/services/hardcover-sync.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { fetchHardcoverList } from '@/lib/services/hardcover-sync.service';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { z } from 'zod';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.HardcoverShelves');

const AddShelfSchema = z.object({
  listId: z.string().min(1, { message: 'List ID is required' }),
  apiToken: z.string().min(1, { message: 'API Token is required' }),
});

/**
 * GET /api/user/hardcover-shelves
 * List the current user's Hardcover lists with book counts and covers
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const shelves = await prisma.hardcoverShelf.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
      });

      const shelvesWithMeta = shelves.map((shelf) => {
        let books: {
          coverUrl: string;
          asin: string | null;
          title: string;
          author: string;
        }[] = [];
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
          listId: shelf.listId,
          lastSyncAt: shelf.lastSyncAt,
          createdAt: shelf.createdAt,
          bookCount: shelf.bookCount ?? null,
          books,
        };
      });

      return NextResponse.json({ success: true, shelves: shelvesWithMeta });
    } catch (error) {
      logger.error('Failed to list Hardcover lists', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'Failed to list Hardcover lists' },
        { status: 500 },
      );
    }
  });
}

/**
 * POST /api/user/hardcover-shelves
 * Add a new Hardcover list subscription
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const body = await req.json();
      let { listId, apiToken } = AddShelfSchema.parse(body);

      // Clean up token in case user pasted "Bearer " prefix
      apiToken = apiToken.trim();
      if (apiToken.toLowerCase().startsWith('bearer ')) {
        apiToken = apiToken.slice(7).trim();
      }

      // Check for duplicate
      const existing = await prisma.hardcoverShelf.findUnique({
        where: { userId_listId: { userId: req.user.id, listId } },
      });

      if (existing) {
        return NextResponse.json(
          {
            error: 'DuplicateShelf',
            message: 'You have already added this list',
          },
          { status: 409 },
        );
      }

      // Validate by fetching the Hardcover GraphQL feed
      let listName: string;
      let bookCount: number;
      let initialBooks: {
        coverUrl: string;
        asin: null;
        title: string;
        author: string;
      }[] = [];
      try {
        const fetchedData = await fetchHardcoverList(apiToken, listId);
        listName = fetchedData.listName;
        bookCount = fetchedData.books.length;
        initialBooks = fetchedData.books
          .filter((b) => b.coverUrl)
          .slice(0, 8)
          .map((b) => ({
            coverUrl: b.coverUrl!,
            asin: null,
            title: b.title,
            author: b.author,
          }));
      } catch (error) {
        return NextResponse.json(
          {
            error: 'InvalidHardcoverList',
            message: `Could not fetch the Hardcover list. Check your Token and List ID: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
          { status: 400 },
        );
      }

      const encryptionService = getEncryptionService();
      const encryptedToken = encryptionService.encrypt(apiToken);

      const shelf = await prisma.hardcoverShelf.create({
        data: {
          userId: req.user.id,
          name: listName,
          listId,
          apiToken: encryptedToken,
          bookCount,
          coverUrls:
            initialBooks.length > 0 ? JSON.stringify(initialBooks) : null,
        },
      });

      // Trigger immediate sync for this shelf (unlimited lookups, process all books)
      try {
        const jobQueue = getJobQueueService();
        await jobQueue.addSyncShelvesJob(undefined, shelf.id, 'hardcover', 0);
        logger.info(
          `Triggered immediate sync for Hardcover list "${listName}" (${shelf.id})`,
        );
      } catch (error) {
        logger.error('Failed to trigger immediate list sync', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return NextResponse.json(
        {
          success: true,
          shelf: {
            id: shelf.id,
            name: shelf.name,
            listId: shelf.listId,
            lastSyncAt: shelf.lastSyncAt,
            createdAt: shelf.createdAt,
            bookCount: shelf.bookCount,
            books: initialBooks,
          },
          bookCount,
        },
        { status: 201 },
      );
    } catch (error) {
      logger.error('Failed to add Hardcover list', {
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'ValidationError', details: error.errors },
          { status: 400 },
        );
      }

      return NextResponse.json(
        { error: 'Failed to add Hardcover list' },
        { status: 500 },
      );
    }
  });
}
