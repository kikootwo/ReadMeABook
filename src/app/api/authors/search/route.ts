/**
 * Component: Author Search API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getConfigService } from '@/lib/services/config.service';
import { AUDIBLE_REGIONS, DEFAULT_AUDIBLE_REGION, AudibleRegion } from '@/lib/types/audible';
import { RMABLogger } from '@/lib/utils/logger';
import {
  AudnexusAuthorDetail,
  searchAuthors,
  fetchAuthorDetail,
} from '@/lib/integrations/audnexus-authors';

const logger = RMABLogger.create('API.Authors.Search');

/**
 * GET /api/authors/search?name=Brandon Sanderson
 * Search for authors on Audnexus, deduplicate, and return enriched details
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async () => {
    try {
      const name = request.nextUrl.searchParams.get('name');

      if (!name || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'ValidationError', message: 'Author name is required' },
          { status: 400 }
        );
      }

      // Get configured Audible region
      const configService = getConfigService();
      const audibleRegion: AudibleRegion = await configService.getAudibleRegion();
      const region = AUDIBLE_REGIONS[audibleRegion]?.audnexusParam || AUDIBLE_REGIONS[DEFAULT_AUDIBLE_REGION].audnexusParam;

      logger.info(`Searching authors: "${name}" (region: ${region})`);

      // Step 1: Search for authors (returns list with potential duplicates)
      const searchResults = await searchAuthors(name.trim(), region);

      if (searchResults.length === 0) {
        return NextResponse.json({
          success: true,
          authors: [],
          query: name.trim(),
        });
      }

      // Step 2: Fetch details for all unique authors in parallel
      const detailPromises = searchResults.map(author => fetchAuthorDetail(author.asin, region));
      const detailResults = await Promise.all(detailPromises);

      // Step 3: Build enriched results, filtering out any failed fetches
      const authors = detailResults
        .filter((detail): detail is AudnexusAuthorDetail => detail !== null)
        .map(detail => ({
          asin: detail.asin,
          name: detail.name,
          description: detail.description || undefined,
          image: detail.image || undefined,
          genres: detail.genres?.map(g => g.name).slice(0, 3) || [],
          similarCount: detail.similar?.length || 0,
        }));

      logger.info(`Author search complete: "${name}" → ${authors.length} results`);

      return NextResponse.json({
        success: true,
        authors,
        query: name.trim(),
      });
    } catch (error) {
      logger.error('Failed to search authors', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: 'SearchError', message: 'Failed to search authors' },
        { status: 500 }
      );
    }
  });
}
