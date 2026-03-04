/**
 * Component: Audiobook Search API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { enrichAudiobooksWithMatches } from '@/lib/utils/audiobook-matcher';
import { deduplicateAndCollectGroups } from '@/lib/utils/deduplicate-audiobooks';
import { persistDedupGroups } from '@/lib/services/works.service';
import { getCurrentUser } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Audiobooks.Search');

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

    // Deduplicate before enrichment to avoid wasted DB queries on duplicate entries
    const { books: dedupedResults, groups } = deduplicateAndCollectGroups(results.results);

    // Fire-and-forget: persist dedup groups to works table for cross-ASIN matching
    if (groups.length > 0) {
      persistDedupGroups(groups).catch(() => {});
    }

    // Enrich search results with availability and request status information
    const enrichedResults = await enrichAudiobooksWithMatches(dedupedResults, userId);

    return NextResponse.json({
      success: true,
      query: results.query,
      results: enrichedResults,
      totalResults: enrichedResults.length,
      page: results.page,
      hasMore: results.hasMore,
    });
  } catch (error) {
    logger.error('Failed to search audiobooks', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        error: 'SearchError',
        message: 'Failed to search audiobooks',
      },
      { status: 500 }
    );
  }
}
