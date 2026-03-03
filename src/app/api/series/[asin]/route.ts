/**
 * Component: Series Detail API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { scrapeSeriesPage } from '@/lib/integrations/audible-series';
import { enrichAudiobooksWithMatches } from '@/lib/utils/audiobook-matcher';
import { deduplicateAndCollectGroups } from '@/lib/utils/deduplicate-audiobooks';
import { persistDedupGroups } from '@/lib/services/works.service';

const logger = RMABLogger.create('API.Series.Detail');

/**
 * GET /api/series/{asin}
 * Fetch series detail: metadata + books (enriched with availability) + similar series
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

    if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
      return NextResponse.json(
        { error: 'ValidationError', message: 'Valid series ASIN is required' },
        { status: 400 }
      );
    }

    const page = parseInt(request.nextUrl.searchParams.get('page') || '1', 10);

    logger.info(`Fetching series detail: ${asin}, page ${page}`);

    const detail = await scrapeSeriesPage(asin, page);
    if (!detail) {
      return NextResponse.json(
        { error: 'NotFound', message: 'Series not found' },
        { status: 404 }
      );
    }

    // Deduplicate before enrichment to avoid wasted DB queries on duplicate entries
    const { books: dedupedBooks, groups } = deduplicateAndCollectGroups(detail.books);

    // Fire-and-forget: persist dedup groups to works table for cross-ASIN matching
    if (groups.length > 0) {
      persistDedupGroups(groups).catch(() => {});
    }

    // Enrich books with library availability and request status
    const userId = currentUser.sub || undefined;
    const enrichedBooks = await enrichAudiobooksWithMatches(dedupedBooks, userId);

    logger.info(`Series detail complete: "${detail.title}" (${enrichedBooks.length} books, page ${page})`);

    return NextResponse.json({
      success: true,
      series: {
        ...detail,
        books: enrichedBooks,
      },
      hasMore: detail.hasMore,
      page: detail.page,
    });
  } catch (error) {
    logger.error('Failed to fetch series detail', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'FetchError', message: 'Failed to fetch series details' },
      { status: 500 }
    );
  }
}
