/**
 * Component: Combined Shelves API Routes
 * Documentation: documentation/backend/services/goodreads-sync.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { processBooks } from '@/lib/utils/shelf-helpers';

const logger = RMABLogger.create('API.Shelves');

/**
 * GET /api/user/shelves
 * List the current user's shelves (Goodreads, Hardcover) with book counts and covers
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const [goodreads, hardcover] = await Promise.all([
        prisma.goodreadsShelf.findMany({
          where: { userId: req.user.id },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.hardcoverShelf.findMany({
          where: { userId: req.user.id },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      const combined = [
        ...goodreads.map((s) => ({
          id: s.id,
          type: 'goodreads',
          name: s.name,
          sourceId: s.rssUrl,
          lastSyncAt: s.lastSyncAt,
          createdAt: s.createdAt,
          bookCount: s.bookCount ?? null,
          books: processBooks(s.coverUrls),
        })),
        ...hardcover.map((s) => ({
          id: s.id,
          type: 'hardcover',
          name: s.name,
          sourceId: s.listId,
          lastSyncAt: s.lastSyncAt,
          createdAt: s.createdAt,
          bookCount: s.bookCount ?? null,
          books: processBooks(s.coverUrls),
        })),
      ].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      return NextResponse.json({ success: true, shelves: combined });
    } catch (error) {
      logger.error('Failed to list shelves', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'Failed to list shelves' },
        { status: 500 },
      );
    }
  });
}
