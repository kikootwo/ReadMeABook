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
import { groupIndexersByCategories, getGroupDescription } from '@/lib/utils/indexer-grouping';
import { getLanguageForRegion } from '@/lib/constants/language-config';
import type { AudibleRegion } from '@/lib/types/audible';
import { z } from 'zod';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.AudiobookSearch');

const SearchSchema = z.object({
  title: z.string(),
  author: z.string(),
  asin: z.string().optional(), // Optional ASIN for runtime-based size scoring
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
      const { title, author, asin } = SearchSchema.parse(body);

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

      if (indexersConfig.length === 0) {
        return NextResponse.json(
          { error: 'ConfigError', message: 'No indexers enabled. Please enable at least one indexer in settings.' },
          { status: 400 }
        );
      }

      // Build indexer priorities map (indexerId -> priority 1-25, default 10)
      const indexerPriorities = new Map<number, number>(
        indexersConfig.map((indexer: any) => [indexer.id, indexer.priority ?? 10])
      );

      // Get flag configurations
      const flagConfigStr = await configService.get('indexer_flag_config');
      const flagConfigs = flagConfigStr ? JSON.parse(flagConfigStr) : [];

      // Group indexers by their category configuration
      // This minimizes API calls while ensuring each indexer only searches its configured categories
      const { groups, skippedIndexers } = groupIndexersByCategories(indexersConfig);

      if (skippedIndexers.length > 0) {
        const skippedNames = skippedIndexers.map(idx => idx.name).join(', ');
        logger.info(`Skipping ${skippedIndexers.length} indexer(s) with no audiobook categories: ${skippedNames}`);
      }

      logger.info(`Searching ${indexersConfig.length - skippedIndexers.length} enabled indexers in ${groups.length} group${groups.length > 1 ? 's' : ''}`, { searchQuery: title });

      // Log each group for transparency
      groups.forEach((group, index) => {
        logger.debug(`Group ${index + 1}: ${getGroupDescription(group)}`);
      });

      // Search Prowlarr for each group and combine results
      const prowlarr = await getProwlarrService();
      const allResults = [];

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        logger.debug(`Searching group ${i + 1}/${groups.length}: ${getGroupDescription(group)}`);

        try {
          const groupResults = await prowlarr.searchWithVariations(title, author, {
            categories: group.categories,
            indexerIds: group.indexerIds,
            maxResults: 100, // Limit per group
          });

          logger.debug(`Group ${i + 1} returned ${groupResults.length} results`);
          allResults.push(...groupResults);
        } catch (error) {
          logger.error(`Group ${i + 1} search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Continue with other groups even if one fails
        }
      }

      const results = allResults;
      logger.info(`Found ${results.length} total results from ${groups.length} group${groups.length > 1 ? 's' : ''}`);

      if (results.length === 0) {
        return NextResponse.json({
          success: true,
          results: [],
          message: 'No torrents/nzbs found',
        });
      }

      // Fetch runtime from Audnexus if ASIN provided (for size-based scoring/filtering)
      let durationMinutes: number | undefined;
      if (asin) {
        const { getAudibleService } = await import('@/lib/integrations/audible.service');
        const audibleService = getAudibleService();
        const runtime = await audibleService.getRuntime(asin);
        if (runtime) {
          durationMinutes = runtime;
          logger.info(`Fetched runtime: ${runtime} minutes for ASIN ${asin}`);
        } else {
          logger.debug(`No runtime found for ASIN ${asin}`);
        }
      }

      // Log filter info
      const sizeMBThreshold = 20;
      const preFilterCount = results.length;
      const belowThreshold = results.filter(r => (r.size / (1024 * 1024)) < sizeMBThreshold);
      if (belowThreshold.length > 0) {
        logger.info(`Will filter ${belowThreshold.length} results < ${sizeMBThreshold} MB (likely ebooks)`);
      }

      // Get language-specific stop words for ranking
      const region = await configService.getAudibleRegion() as AudibleRegion;
      const langConfig = getLanguageForRegion(region);

      // Rank torrents using the ranking algorithm with indexer priorities and flag configs
      // Note: rankTorrents now filters out results < 20 MB internally
      // requireAuthor: false - interactive search, show all results for user decision
      const rankedResults = rankTorrents(results, { title, author, durationMinutes }, {
        indexerPriorities,
        flagConfigs,
        requireAuthor: false,  // Interactive mode - let user decide
        stopWords: langConfig.stopWords,
        characterReplacements: langConfig.characterReplacements,
      });

      // Log filter results
      const postFilterCount = rankedResults.length;
      if (postFilterCount < preFilterCount) {
        logger.info(`Filtered out ${preFilterCount - postFilterCount} results < ${sizeMBThreshold} MB`);
      }

      // No threshold filtering - show all results like interactive search
      // User can see scores and make their own decision
      logger.debug(`Ranked ${rankedResults.length} results (no threshold filter - user decides)`);

      // Log top 3 results with detailed score breakdown for debugging
      const top3 = rankedResults.slice(0, 3);
      if (top3.length > 0) {
        logger.debug('==================== RANKING DEBUG ====================');
        logger.debug('Search parameters', { requestedTitle: title, requestedAuthor: author });
        logger.debug(`Top ${top3.length} results (out of ${rankedResults.length} total)`);
        logger.debug('--------------------------------------------------------');
        top3.forEach((result, index) => {
          const sizeMB = (result.size / (1024 * 1024)).toFixed(1);
          const mbPerMin = durationMinutes ? ((result.size / (1024 * 1024)) / durationMinutes).toFixed(2) : 'N/A';

          logger.debug(`${index + 1}. "${result.title}"`, {
            indexer: result.indexer,
            indexerId: result.indexerId,
            baseScore: `${result.score.toFixed(1)}/100`,
            matchScore: `${result.breakdown.matchScore.toFixed(1)}/60`,
            formatScore: `${result.breakdown.formatScore.toFixed(1)}/10 (${result.format || 'unknown'})`,
            sizeScore: durationMinutes
              ? `${result.breakdown.sizeScore.toFixed(1)}/15 (${sizeMB} MB, ${mbPerMin} MB/min)`
              : 'N/A (no runtime)',
            seederScore: `${result.breakdown.seederScore.toFixed(1)}/15 (${result.seeders !== undefined ? result.seeders + ' seeders' : 'N/A for Usenet'})`,
            bonusPoints: `+${result.bonusPoints.toFixed(1)}`,
            bonusModifiers: result.bonusModifiers.map(mod => `${mod.reason}: +${mod.points.toFixed(1)}`),
            finalScore: result.finalScore.toFixed(1),
            notes: result.breakdown.notes,
          });
        });
        logger.debug('========================================================');
      }

      // Add rank position to each result
      const resultsWithRank = rankedResults.map((result, index) => ({
        ...result,
        rank: index + 1,
      }));

      return NextResponse.json({
        success: true,
        results: resultsWithRank,
        message: rankedResults.length > 0
          ? `Found ${rankedResults.length} results`
          : 'No results found',
      });
    } catch (error) {
      logger.error('Failed to search for torrents', { error: error instanceof Error ? error.message : String(error) });

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
