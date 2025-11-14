/**
 * Component: Audiobook Search API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { enrichAudiobooksWithMatches } from '@/lib/utils/audiobook-matcher';
import { getCurrentUser } from '@/lib/middleware/auth';

/**
 * GET /api/audiobooks/search?q=query&page=1
 * Search for audiobooks on Audible
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || searchParams.get('query');
    const page = parseInt(searchParams.get('page') || '1', 10);

    if (!query) {
      return NextResponse.json(
        {
          error: 'ValidationError',
          message: 'Search query is required',
        },
        { status: 400 }
      );
    }

    const audibleService = getAudibleService();
    const results = await audibleService.search(query, page);

    // Get current user (optional - for request status enrichment)
    const currentUser = getCurrentUser(request);
    const userId = currentUser?.sub || undefined;

    // Enrich search results with availability and request status information
    const enrichedResults = await enrichAudiobooksWithMatches(results.results, userId);

    return NextResponse.json({
      success: true,
      query: results.query,
      results: enrichedResults,
      totalResults: results.totalResults,
      page: results.page,
      hasMore: results.hasMore,
    });
  } catch (error) {
    console.error('Failed to search audiobooks:', error);
    return NextResponse.json(
      {
        error: 'SearchError',
        message: 'Failed to search audiobooks',
      },
      { status: 500 }
    );
  }
}
