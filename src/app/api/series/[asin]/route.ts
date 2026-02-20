/**
 * Component: Series Detail API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { scrapeSeriesPage } from '@/lib/integrations/audible-series';
import { enrichAudiobooksWithMatches } from '@/lib/utils/audiobook-matcher';

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

    logger.info(`Fetching series detail: ${asin}`);

    const detail = await scrapeSeriesPage(asin);
    if (!detail) {
      return NextResponse.json(
        { error: 'NotFound', message: 'Series not found' },
        { status: 404 }
      );
    }

    // Enrich books with library availability and request status
    const userId = currentUser.sub || undefined;
    const enrichedBooks = await enrichAudiobooksWithMatches(detail.books, userId);

    logger.info(`Series detail complete: "${detail.title}" (${enrichedBooks.length} books)`);

    return NextResponse.json({
      success: true,
      series: {
        ...detail,
        books: enrichedBooks,
      },
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
