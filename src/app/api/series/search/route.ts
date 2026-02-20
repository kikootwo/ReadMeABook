/**
 * Component: Series Search API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { searchForSeries } from '@/lib/integrations/audible-series';

const logger = RMABLogger.create('API.Series.Search');

/**
 * GET /api/series/search?q=game+of+thrones
 * Search for audiobook series on Audible, de-duplicate, and return enriched summaries
 */
export async function GET(request: NextRequest) {
  try {
    // Require authentication
    const currentUser = getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    const query = request.nextUrl.searchParams.get('q');

    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'ValidationError', message: 'Search query is required' },
        { status: 400 }
      );
    }

    logger.info(`Searching series: "${query}"`);

    const series = await searchForSeries(query.trim());

    logger.info(`Series search complete: "${query}" -> ${series.length} results`);

    return NextResponse.json({
      success: true,
      series,
      query: query.trim(),
    });
  } catch (error) {
    logger.error('Failed to search series', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'SearchError', message: 'Failed to search series' },
      { status: 500 }
    );
  }
}
