/**
 * Component: Audiobook Search API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { enrichAudiobooksWithMatches } from '@/lib/utils/audiobook-matcher';
import { deduplicateAndCollectGroups } from '@/lib/utils/deduplicate-audiobooks';
import { persistDedupGroups, collapseByExistingWorks } from '@/lib/services/works.service';
import { getCurrentUserAsync } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { annotateWithIgnoreStatus } from '@/lib/utils/ignored-audiobooks';

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
    const results = await audibleService.search(query, page, { respectLanguageFilter: true });

    // Get current user (optional — JWT or API token — for request-status enrichment)
    const currentUser = await getCurrentUserAsync(request);
    const userId = currentUser?.sub || undefined;

    // Two-pass dedup: local title/narrator/duration matching first, then collapse
    // any remaining duplicates that the works table already knows are the same book
    // (handles cases where source metadata diverges across paths or pages).
    const { books: dedupedResults, groups } = deduplicateAndCollectGroups(results.results);

    if (groups.length > 0) {
      persistDedupGroups(groups).catch(() => {});
    }

    const collapsedResults = await collapseByExistingWorks(dedupedResults);

    // Enrich search results with availability and request status information
    const enrichedResults = await enrichAudiobooksWithMatches(collapsedResults, userId);

    // Annotate with per-user ignore status
    const annotatedResults = await annotateWithIgnoreStatus(enrichedResults, userId);

    return NextResponse.json({
      success: true,
      query: results.query,
      results: annotatedResults,
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
