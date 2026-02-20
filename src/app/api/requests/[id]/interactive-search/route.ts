/**
 * Component: Interactive Search API
 * Documentation: documentation/phase3/prowlarr.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getProwlarrService } from '@/lib/integrations/prowlarr.service';
import { rankTorrents } from '@/lib/utils/ranking-algorithm';
import { groupIndexersByCategories, getGroupDescription } from '@/lib/utils/indexer-grouping';
import { getLanguageForRegion } from '@/lib/constants/language-config';
import type { AudibleRegion } from '@/lib/types/audible';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveInteractiveSearchAccess } from '@/lib/utils/permissions';

const logger = RMABLogger.create('API.InteractiveSearch');

/**
 * POST /api/requests/[id]/interactive-search
 * Search for torrents and return results for user selection
 * Body (optional): { customTitle?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const { id } = await params;

      // Parse optional request body
      let customTitle: string | undefined;
      try {
        const body = await req.json();
        customTitle = body.customTitle;
      } catch (e) {
        // No body or invalid JSON - that's okay, customTitle will be undefined
      }

      const requestRecord = await prisma.request.findUnique({
        where: { id },
        include: {
          audiobook: true,
        },
      });

      if (!requestRecord) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Request not found' },
          { status: 404 }
        );
      }

      // Check authorization
      if (requestRecord.userId !== req.user.id && req.user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'You do not have access to this request' },
          { status: 403 }
        );
      }

      // Check if request is awaiting approval
      if (requestRecord.status === 'awaiting_approval') {
        return NextResponse.json(
          { error: 'AwaitingApproval', message: 'This request is awaiting admin approval. You cannot search for torrents until it is approved.' },
          { status: 403 }
        );
      }

      // Check interactive search access permission
      const callingUser = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { role: true, interactiveSearchAccess: true },
      });
      if (!callingUser || !(await resolveInteractiveSearchAccess(callingUser.role, callingUser.interactiveSearchAccess))) {
        return NextResponse.json(
          { error: 'Forbidden', message: 'You do not have interactive search access. Contact your admin to enable this permission.' },
          { status: 403 }
        );
      }

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
      const { groups, skippedIndexers } = groupIndexersByCategories(indexersConfig);

      if (skippedIndexers.length > 0) {
        const skippedNames = skippedIndexers.map(idx => idx.name).join(', ');
        logger.info(`Skipping ${skippedIndexers.length} indexer(s) with no audiobook categories: ${skippedNames}`);
      }

      // Use custom title if provided, otherwise use audiobook's title
      const searchTitle = customTitle || requestRecord.audiobook.title;
      const searchAuthor = requestRecord.audiobook.author;

      logger.info(`Searching ${indexersConfig.length - skippedIndexers.length} enabled indexers in ${groups.length} group${groups.length > 1 ? 's' : ''}`, { searchTitle });
      if (customTitle) {
        logger.debug('Using custom search title', { customTitle, originalTitle: requestRecord.audiobook.title });
      }

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
          const groupResults = await prowlarr.searchWithVariations(searchTitle, searchAuthor, {
            categories: group.categories,
            indexerIds: group.indexerIds,
            maxResults: 100,
          });

          logger.debug(`Group ${i + 1} returned ${groupResults.length} results`);
          allResults.push(...groupResults);
        } catch (error) {
          logger.error(`Group ${i + 1} search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Continue with other groups even if one fails
        }
      }

      const results = allResults;
      logger.info(`Found ${results.length} total results from ${groups.length} group${groups.length > 1 ? 's' : ''}`, { requestId: id });

      if (results.length === 0) {
        return NextResponse.json({
          success: true,
          results: [],
          message: 'No torrents/nzbs found',
        });
      }

      // Fetch runtime from Audnexus if ASIN available (for size-based scoring)
      let durationMinutes: number | undefined;
      if (requestRecord.audiobook.audibleAsin) {
        try {
          const { getAudibleService } = await import('@/lib/integrations/audible.service');
          const audibleService = getAudibleService();
          const runtime = await audibleService.getRuntime(requestRecord.audiobook.audibleAsin);
          if (runtime) {
            durationMinutes = runtime;
            logger.info(`Fetched runtime: ${runtime} minutes for ASIN ${requestRecord.audiobook.audibleAsin}`);
          } else {
            logger.debug(`No runtime found for ASIN ${requestRecord.audiobook.audibleAsin}`);
          }
        } catch (error) {
          logger.debug(`Failed to fetch runtime for ASIN ${requestRecord.audiobook.audibleAsin}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Get language-specific stop words for ranking
      const region = await configService.getAudibleRegion() as AudibleRegion;
      const langConfig = getLanguageForRegion(region);

      // Rank torrents using the ranking algorithm with indexer priorities and flag configs
      // Always use the audiobook's title/author for ranking (not custom search query)
      // requireAuthor: false - interactive mode, show all results for user decision
      const rankedResults = rankTorrents(results, {
        title: requestRecord.audiobook.title,
        author: requestRecord.audiobook.author,
        durationMinutes,
      }, {
        indexerPriorities,
        flagConfigs,
        requireAuthor: false,  // Interactive mode - let user decide
        stopWords: langConfig.stopWords,
        characterReplacements: langConfig.characterReplacements,
      });

      // No threshold filtering for interactive search - show all results
      // User can see scores and make their own decision
      logger.debug(`Ranked ${rankedResults.length} results (no threshold filter - user decides)`);

      // Log top 3 results with detailed score breakdown for debugging
      const top3 = rankedResults.slice(0, 3);
      if (top3.length > 0) {
        logger.debug('==================== RANKING DEBUG ====================');
        logger.debug('Search parameters', { searchTitle, requestedTitle: requestRecord.audiobook.title, requestedAuthor: requestRecord.audiobook.author });
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
      logger.error('Failed to perform interactive search', { error: error instanceof Error ? error.message : String(error) });
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
