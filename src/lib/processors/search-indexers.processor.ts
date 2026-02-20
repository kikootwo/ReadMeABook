/**
 * Component: Search Indexers Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { SearchIndexersPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getProwlarrService } from '../integrations/prowlarr.service';
import { getRankingAlgorithm } from '../utils/ranking-algorithm';
import { groupIndexersByCategories, getGroupDescription } from '../utils/indexer-grouping';
import { RMABLogger } from '../utils/logger';
import { getLanguageForRegion } from '../constants/language-config';
import type { AudibleRegion } from '../types/audible';

/**
 * Process search indexers job
 * Searches configured indexers for audiobook torrents
 */
export async function processSearchIndexers(payload: SearchIndexersPayload): Promise<any> {
  const { requestId, audiobook, jobId } = payload;

  const logger = RMABLogger.forJob(jobId, 'SearchIndexers');

  logger.info(`Processing request ${requestId} for "${audiobook.title}"`);

  try {
    // Update request status to searching
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'searching',
        searchAttempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    // Get enabled indexers from configuration
    const { getConfigService } = await import('../services/config.service');
    const configService = getConfigService();
    const indexersConfigStr = await configService.get('prowlarr_indexers');

    if (!indexersConfigStr) {
      throw new Error('No indexers configured. Please configure indexers in settings.');
    }

    const indexersConfig = JSON.parse(indexersConfigStr);

    if (indexersConfig.length === 0) {
      throw new Error('No indexers enabled. Please enable at least one indexer in settings.');
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

    logger.info(`Searching ${indexersConfig.length - skippedIndexers.length} enabled indexers in ${groups.length} group${groups.length > 1 ? 's' : ''}`);

    // Log each group for transparency
    groups.forEach((group, index) => {
      logger.info(`Group ${index + 1}: ${getGroupDescription(group)}`);
    });

    // Get Prowlarr service
    const prowlarr = await getProwlarrService();

    logger.info(`Searching for: "${audiobook.title}" by "${audiobook.author}"`);

    // Search Prowlarr for each group and combine results
    const allResults = [];

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      logger.info(`Searching group ${i + 1}/${groups.length}: ${getGroupDescription(group)}`);

      try {
        const groupResults = await prowlarr.searchWithVariations(audiobook.title, audiobook.author, {
          categories: group.categories,
          indexerIds: group.indexerIds,
          minSeeders: 1, // Only torrents with at least 1 seeder
          maxResults: 100, // Limit per group
        });

        logger.info(`Group ${i + 1} returned ${groupResults.length} results`);
        allResults.push(...groupResults);
      } catch (error) {
        logger.error(`Group ${i + 1} search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Continue with other groups even if one fails
      }
    }

    const searchResults = allResults;
    logger.info(`Found ${searchResults.length} total results from ${groups.length} group${groups.length > 1 ? 's' : ''}`);

    if (searchResults.length === 0) {
      // No results found - queue for re-search instead of failing
      logger.warn(`No torrents/nzbs found for request ${requestId}, marking as awaiting_search`);

      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'awaiting_search',
          errorMessage: 'No torrents/nzbs found. Will retry automatically.',
          lastSearchAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return {
        success: false,
        message: 'No torrents/nzbs found, queued for re-search',
        requestId,
      };
    }

    // Fetch runtime from Audnexus if ASIN available (for size-based scoring/filtering)
    let durationMinutes: number | undefined;
    if (audiobook.asin) {
      const { getAudibleService } = await import('../integrations/audible.service');
      const audibleService = getAudibleService();
      const runtime = await audibleService.getRuntime(audiobook.asin);
      if (runtime) {
        durationMinutes = runtime;
        logger.info(`Fetched runtime: ${runtime} minutes for ASIN ${audiobook.asin}`);
      } else {
        logger.debug(`No runtime found for ASIN ${audiobook.asin}`);
      }
    }

    // Log filter info
    const sizeMBThreshold = 20;
    const preFilterCount = searchResults.length;
    const belowThreshold = searchResults.filter(r => (r.size / (1024 * 1024)) < sizeMBThreshold);
    if (belowThreshold.length > 0) {
      logger.info(`Will filter ${belowThreshold.length} results < ${sizeMBThreshold} MB (likely ebooks)`);
    }

    // Get ranking algorithm and language-specific stop words
    const ranker = getRankingAlgorithm();
    const region = await configService.getAudibleRegion() as AudibleRegion;
    const langConfig = getLanguageForRegion(region);

    // Rank results with indexer priorities and flag configs
    // Note: rankTorrents now filters out results < 20 MB internally
    // requireAuthor: true (default) - strict filtering for automatic selection
    const rankedResults = ranker.rankTorrents(searchResults, {
      title: audiobook.title,
      author: audiobook.author,
      durationMinutes,
    }, {
      indexerPriorities,
      flagConfigs,
      requireAuthor: true,  // Automatic mode - prevent wrong authors
      stopWords: langConfig.stopWords,
      characterReplacements: langConfig.characterReplacements,
    });

    // Log filter results
    const postFilterCount = rankedResults.length;
    if (postFilterCount < preFilterCount) {
      logger.info(`Filtered out ${preFilterCount - postFilterCount} results < ${sizeMBThreshold} MB`);
    }

    // Dual threshold filtering:
    // 1. Base score must be >= 50 (quality minimum)
    // 2. Final score must be >= 50 (not disqualified by negative bonuses)
    const filteredResults = rankedResults.filter(result =>
      result.score >= 50 && result.finalScore >= 50
    );

    const disqualifiedByNegativeBonus = rankedResults.filter(result =>
      result.score >= 50 && result.finalScore < 50
    ).length;

    logger.info(`Ranked ${rankedResults.length} results, ${filteredResults.length} above threshold (50/100 base + final)`);
    if (disqualifiedByNegativeBonus > 0) {
      logger.info(`${disqualifiedByNegativeBonus} torrents disqualified by negative flag bonuses`);
    }

    if (filteredResults.length === 0) {
      // No quality results found - queue for re-search instead of failing
      logger.warn(`No quality matches found for request ${requestId} (all below 50/100), marking as awaiting_search`);

      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'awaiting_search',
          errorMessage: 'No quality matches found. Will retry automatically.',
          lastSearchAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return {
        success: false,
        message: 'No quality matches found, queued for re-search',
        requestId,
      };
    }

    // Select best result
    const bestResult = filteredResults[0];

    // Log top 3 results with detailed breakdown
    const top3 = filteredResults.slice(0, 3);
    logger.info(`==================== RANKING DEBUG ====================`);
    logger.info(`Requested Title: "${audiobook.title}"`);
    logger.info(`Requested Author: "${audiobook.author}"`);
    logger.info(`Top ${top3.length} results (out of ${filteredResults.length} above threshold):`);
    logger.info(`--------------------------------------------------------`);
    for (let i = 0; i < top3.length; i++) {
      const result = top3[i];
      const sizeMB = (result.size / (1024 * 1024)).toFixed(1);
      const mbPerMin = durationMinutes ? ((result.size / (1024 * 1024)) / durationMinutes).toFixed(2) : 'N/A';

      logger.info(`${i + 1}. "${result.title}"`);
      logger.info(`   Indexer: ${result.indexer}${result.indexerId ? ` (ID: ${result.indexerId})` : ''}`);
      logger.info(``);
      logger.info(`   Base Score: ${result.score.toFixed(1)}/100`);
      logger.info(`   - Title/Author Match: ${result.breakdown.matchScore.toFixed(1)}/60`);
      logger.info(`   - Format Quality: ${result.breakdown.formatScore.toFixed(1)}/10 (${result.format || 'unknown'})`);
      logger.info(`   - Size Quality: ${durationMinutes ? `${result.breakdown.sizeScore.toFixed(1)}/15 (${sizeMB} MB, ${mbPerMin} MB/min, ${durationMinutes} min runtime)` : 'N/A (no runtime data)'}`);
      logger.info(`   - Seeder Count: ${result.breakdown.seederScore.toFixed(1)}/15 (${result.seeders !== undefined ? result.seeders + ' seeders' : 'N/A for Usenet'})`);
      logger.info(``);
      logger.info(`   Bonus Points: +${result.bonusPoints.toFixed(1)}`);
      if (result.bonusModifiers.length > 0) {
        for (const mod of result.bonusModifiers) {
          logger.info(`   - ${mod.reason}: +${mod.points.toFixed(1)}`);
        }
      }
      logger.info(``);
      logger.info(`   Final Score: ${result.finalScore.toFixed(1)}`);
      if (result.breakdown.notes.length > 0) {
        logger.info(`   Notes: ${result.breakdown.notes.join(', ')}`);
      }
      if (i < top3.length - 1) {
        logger.info(`--------------------------------------------------------`);
      }
    }
    logger.info(`========================================================`);
    logger.info(`Selected best result: ${bestResult.title} (final score: ${bestResult.finalScore.toFixed(1)})`);

    // Trigger download job with best result
    const jobQueue = getJobQueueService();
    await jobQueue.addDownloadJob(requestId, {
      id: audiobook.id,
      title: audiobook.title,
      author: audiobook.author,
    }, bestResult);

    return {
      success: true,
      message: `Found ${filteredResults.length} quality matches, selected best torrent`,
      requestId,
      resultsCount: filteredResults.length,
      selectedTorrent: {
        title: bestResult.title,
        score: bestResult.score,
        seeders: bestResult.seeders || 0,
        format: bestResult.format,
      },
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error during search',
        updatedAt: new Date(),
      },
    });

    throw error;
  }
}
