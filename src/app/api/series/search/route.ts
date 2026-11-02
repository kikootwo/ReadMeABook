/**
 * Component: Series Search API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { searchForSeries, SeriesSearchUnavailableError } from '@/lib/integrations/audible-series';

const logger = RMABLogger.create('API.Series.Search');

/**
 * GET /api/series/search?q=game+of+thrones
 * Search for audiobook series in the Audible catalog. 502 when Audible did not answer.
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async () => {
    try {
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
      if (error instanceof SeriesSearchUnavailableError) {
        return NextResponse.json(
          { error: 'AudibleUnavailable', message: "Audible didn't return series results. Try again in a moment." },
          { status: 502 }
        );
      }
      logger.error('Failed to search series', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'SearchError', message: 'Failed to search series' },
        { status: 500 }
      );
    }
  });
}
