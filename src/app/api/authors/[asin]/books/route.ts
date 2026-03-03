/**
 * Component: Author Books API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { enrichAudiobooksWithMatches } from '@/lib/utils/audiobook-matcher';
import { deduplicateAndCollectGroups } from '@/lib/utils/deduplicate-audiobooks';
import { persistDedupGroups } from '@/lib/services/works.service';
import { getCurrentUser } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';

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
  try {
    const currentUser = getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

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

    // Deduplicate before enrichment to avoid wasted DB queries on duplicate entries
    const { books: dedupedBooks, groups } = deduplicateAndCollectGroups(result.books);

    // Fire-and-forget: persist dedup groups to works table for cross-ASIN matching
    if (groups.length > 0) {
      persistDedupGroups(groups).catch(() => {});
    }

    // Enrich with library availability and request status
    const userId = currentUser.sub || undefined;
    const enrichedBooks = await enrichAudiobooksWithMatches(dedupedBooks, userId);

    logger.info(`Author books complete: "${authorName}" → ${enrichedBooks.length} books (page ${page})`);

    return NextResponse.json({
      success: true,
      books: enrichedBooks,
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
}
