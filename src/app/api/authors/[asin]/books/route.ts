/**
 * Component: Author Books API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { enrichAudiobooksWithMatches } from '@/lib/utils/audiobook-matcher';
import { deduplicateAndCollectGroups } from '@/lib/utils/deduplicate-audiobooks';
import { persistDedupGroups, collapseByExistingWorks } from '@/lib/services/works.service';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { annotateWithIgnoreStatus } from '@/lib/utils/ignored-audiobooks';

const logger = RMABLogger.create('API.Authors.Books');

/**
 * GET /api/authors/{asin}/books?name=Author+Name
 * Scrape Audible for all books by this author, filtered by ASIN and English language.
 * Enriched with library availability and request status.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      const { asin } = await params;
      const authorName = request.nextUrl.searchParams.get('name');

      if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
        return NextResponse.json(
          { error: 'ValidationError', message: 'Valid author ASIN is required' },
          { status: 400 }
        );
      }

      if (!authorName || authorName.trim().length === 0) {
        return NextResponse.json(
          { error: 'ValidationError', message: 'Author name is required' },
          { status: 400 }
        );
      }

      const page = parseInt(request.nextUrl.searchParams.get('page') || '1', 10);

      logger.info(`Fetching books for author "${authorName}" (ASIN: ${asin}), page ${page}`);

      const audibleService = getAudibleService();
      const result = await audibleService.searchByAuthorAsin(authorName.trim(), asin, page);

      // Two-pass dedup: local title/narrator/duration matching first, then collapse
      // any remaining duplicates that the works table already knows are the same book
      // (handles cases where source metadata diverges across paths or pages).
      const { books: dedupedBooks, groups } = deduplicateAndCollectGroups(result.books);

      if (groups.length > 0) {
        persistDedupGroups(groups).catch(() => {});
      }

      const collapsedBooks = await collapseByExistingWorks(dedupedBooks);

      // Enrich with library availability and request status
      const userId = req.user!.id;
      const enrichedBooks = await enrichAudiobooksWithMatches(collapsedBooks, userId);

      // Annotate with per-user ignore status
      const annotatedBooks = await annotateWithIgnoreStatus(enrichedBooks, userId);

      logger.info(`Author books complete: "${authorName}" → ${annotatedBooks.length} books (page ${page})`);

      return NextResponse.json({
        success: true,
        books: annotatedBooks,
        authorName: authorName.trim(),
        authorAsin: asin,
        totalBooks: enrichedBooks.length,
        hasMore: result.hasMore,
        page: result.page,
      });
    } catch (error) {
      logger.error('Failed to fetch author books', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: 'FetchError', message: 'Failed to fetch author books' },
        { status: 500 }
      );
    }
  });
}
