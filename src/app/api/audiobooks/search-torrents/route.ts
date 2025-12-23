/**
 * Component: Audiobook Torrent Search API
 * Documentation: documentation/phase3/prowlarr.md
 *
 * Search for torrents without creating a request first
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getProwlarrService } from '@/lib/integrations/prowlarr.service';
import { rankTorrents } from '@/lib/utils/ranking-algorithm';
import { z } from 'zod';

const SearchSchema = z.object({
  title: z.string(),
  author: z.string(),
});

/**
 * POST /api/audiobooks/search-torrents
 * Search for torrents for an audiobook (no request required)
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const body = await req.json();
      const { title, author } = SearchSchema.parse(body);

      // Get enabled indexers from configuration
      const { getConfigService } = await import('@/lib/services/config.service');
      const configService = getConfigService();
      const indexersConfigStr = await configService.get('prowlarr_indexers');

      if (!indexersConfigStr) {
        return NextResponse.json(
          { error: 'ConfigError', message: 'No indexers configured. Please configure indexers in settings.' },
          { status: 400 }
        );
      }

      const indexersConfig = JSON.parse(indexersConfigStr);
      const enabledIndexerIds = indexersConfig.map((indexer: any) => indexer.id);

      if (enabledIndexerIds.length === 0) {
        return NextResponse.json(
          { error: 'ConfigError', message: 'No indexers enabled. Please enable at least one indexer in settings.' },
          { status: 400 }
        );
      }

      // Search Prowlarr for torrents - ONLY enabled indexers
      const prowlarr = await getProwlarrService();
      const searchQuery = `${title} ${author}`;

      console.log(`[AudiobookSearch] Searching ${enabledIndexerIds.length} enabled indexers for: ${searchQuery}`);

      const results = await prowlarr.search(searchQuery, {
        indexerIds: enabledIndexerIds,
      });

      if (results.length === 0) {
        return NextResponse.json({
          success: true,
          results: [],
          message: 'No torrents found',
        });
      }

      // Rank torrents using the ranking algorithm
      const rankedResults = rankTorrents(results, { title, author });

      // Add rank position to each result
      const resultsWithRank = rankedResults.map((result, index) => ({
        ...result,
        rank: index + 1,
      }));

      console.log(`[AudiobookSearch] Found ${resultsWithRank.length} results for "${title}" by ${author}`);

      return NextResponse.json({
        success: true,
        results: resultsWithRank,
        message: `Found ${resultsWithRank.length} torrents`,
      });
    } catch (error) {
      console.error('Failed to search for torrents:', error);

      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            error: 'ValidationError',
            details: error.errors,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          error: 'SearchError',
          message: error instanceof Error ? error.message : 'Failed to search for torrents',
        },
        { status: 500 }
      );
    }
  });
}
