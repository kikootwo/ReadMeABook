/**
 * Component: Interactive Search Ebook API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Searches for ebooks from multiple sources (Anna's Archive + Indexers)
 * Returns combined results for user selection in interactive modal
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getConfigService } from '@/lib/services/config.service';
import { getProwlarrService } from '@/lib/integrations/prowlarr.service';
import { rankEbookTorrents, RankedEbookTorrent } from '@/lib/utils/ranking-algorithm';
import { groupIndexersByCategories, getGroupDescription } from '@/lib/utils/indexer-grouping';
import { RMABLogger } from '@/lib/utils/logger';
import { getLanguageForRegion } from '@/lib/constants/language-config';
import type { AudibleRegion } from '@/lib/types/audible';
import {
  searchByAsin,
  searchByTitle,
  getSlowDownloadLinks,
} from '@/lib/services/ebook-scraper';

const logger = RMABLogger.create('API.InteractiveSearchEbook');

// Unified result type for frontend
export interface EbookSearchResult {
  // Common fields (match RankedTorrent shape for UI compatibility)
  guid: string;
  title: string;
  size: number;
  seeders?: number;
  indexer: string;
  indexerId?: number;
  publishDate: Date;
  downloadUrl: string;
  infoUrl?: string;
  protocol?: string; // 'torrent' or 'usenet' - determines download client

  // Ranking fields
  score: number;
  finalScore: number;
  bonusPoints: number;
  bonusModifiers: Array<{ type: string; value: number; points: number; reason: string }>;
  rank: number;
  breakdown: {
    formatScore: number;
    sizeScore: number;
    seederScore: number;
    matchScore: number;
    totalScore: number;
    notes: string[];
  };

  // Ebook-specific fields
  source: 'annas_archive' | 'prowlarr';
  format?: string;
  md5?: string;
  downloadUrls?: string[];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id: parentRequestId } = await params;
        const body = await request.json().catch(() => ({}));
        const customTitle = body.customTitle as string | undefined;

        // Get the parent audiobook request
        const parentRequest = await prisma.request.findUnique({
          where: { id: parentRequestId },
          include: { audiobook: true },
        });

        if (!parentRequest) {
          return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }

        if (parentRequest.type !== 'audiobook') {
          return NextResponse.json({ error: 'Can only search ebooks for audiobook requests' }, { status: 400 });
        }

        if (!['downloaded', 'available'].includes(parentRequest.status)) {
          return NextResponse.json(
            { error: `Cannot search ebooks for request in ${parentRequest.status} status` },
            { status: 400 }
          );
        }

        // Check for existing non-retryable ebook request
        const existingEbookRequest = await prisma.request.findFirst({
          where: {
            parentRequestId,
            type: 'ebook',
            deletedAt: null,
          },
        });

        if (existingEbookRequest && !['failed', 'awaiting_search'].includes(existingEbookRequest.status)) {
          return NextResponse.json({
            error: `E-book request already exists (status: ${existingEbookRequest.status})`,
            existingRequestId: existingEbookRequest.id,
          }, { status: 400 });
        }

        // Get ebook configuration
        const configService = getConfigService();
        const [annasArchiveEnabled, indexerSearchEnabled, preferredFormat, baseUrl, flaresolverrUrl] = await Promise.all([
          configService.get('ebook_annas_archive_enabled'),
          configService.get('ebook_indexer_search_enabled'),
          configService.get('ebook_sidecar_preferred_format'),
          configService.get('ebook_sidecar_base_url'),
          configService.get('ebook_sidecar_flaresolverr_url'),
        ]);

        const isAnnasArchiveEnabled = annasArchiveEnabled === 'true';
        const isIndexerSearchEnabled = indexerSearchEnabled === 'true';
        const format = preferredFormat || 'epub';
        const annasBaseUrl = baseUrl || 'https://annas-archive.li';

        // Get language code from Audible region config
        const region = await configService.getAudibleRegion() as AudibleRegion;
        const langConfig = getLanguageForRegion(region);
        const languageCode = langConfig.annasArchiveLang;

        if (!isAnnasArchiveEnabled && !isIndexerSearchEnabled) {
          return NextResponse.json(
            { error: 'No ebook sources enabled. Enable Anna\'s Archive or Indexer Search in settings.' },
            { status: 400 }
          );
        }

        const audiobook = parentRequest.audiobook;
        const searchTitle = customTitle || audiobook.title;

        logger.info(`Interactive ebook search for "${searchTitle}" by ${audiobook.author}`);
        logger.info(`Sources: Anna's Archive=${isAnnasArchiveEnabled}, Indexer=${isIndexerSearchEnabled}`);

        // Search both sources in parallel
        const searchPromises: Promise<EbookSearchResult[] | null>[] = [];

        if (isAnnasArchiveEnabled) {
          searchPromises.push(
            searchAnnasArchiveForInteractive(
              audiobook.audibleAsin || undefined,
              searchTitle,
              audiobook.author,
              format,
              annasBaseUrl,
              flaresolverrUrl || undefined,
              languageCode
            ).catch((err) => {
              logger.error(`Anna's Archive search failed: ${err.message}`);
              return null;
            })
          );
        }

        if (isIndexerSearchEnabled) {
          searchPromises.push(
            searchIndexersForInteractive(
              searchTitle,
              audiobook.author,
              format
            ).catch((err) => {
              logger.error(`Indexer search failed: ${err.message}`);
              return null;
            })
          );
        }

        const searchResults = await Promise.all(searchPromises);

        // Combine results: Anna's Archive first (if found), then ranked indexer results
        const combinedResults: EbookSearchResult[] = [];
        let rank = 1;

        // Add Anna's Archive result first (if enabled and found)
        if (isAnnasArchiveEnabled && searchResults[0]) {
          const annasResults = searchResults[0];
          for (const result of annasResults) {
            combinedResults.push({ ...result, rank: rank++ });
          }
        }

        // Add indexer results (already ranked)
        const indexerResultsIndex = isAnnasArchiveEnabled ? 1 : 0;
        if (isIndexerSearchEnabled && searchResults[indexerResultsIndex]) {
          const indexerResults = searchResults[indexerResultsIndex];
          for (const result of indexerResults) {
            combinedResults.push({ ...result, rank: rank++ });
          }
        }

        logger.info(`Found ${combinedResults.length} total ebook results`);

        return NextResponse.json({
          results: combinedResults,
          searchTitle,
          preferredFormat: format,
        });

      } catch (error) {
        logger.error('Unexpected error', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Internal server error' },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * Search Anna's Archive and return normalized results
 */
async function searchAnnasArchiveForInteractive(
  asin: string | undefined,
  title: string,
  author: string,
  preferredFormat: string,
  baseUrl: string,
  flaresolverrUrl?: string,
  languageCode: string = 'en'
): Promise<EbookSearchResult[]> {
  let md5: string | null = null;
  let searchMethod: 'asin' | 'title' = 'title';

  // Try ASIN search first
  if (asin) {
    logger.info(`Searching Anna's Archive by ASIN: ${asin}`);
    md5 = await searchByAsin(asin, preferredFormat, baseUrl, undefined, flaresolverrUrl, languageCode);
    if (md5) {
      searchMethod = 'asin';
      logger.info(`Found via ASIN: ${md5}`);
    }
  }

  // Fallback to title search
  if (!md5) {
    logger.info(`Searching Anna's Archive by title: "${title}"`);
    md5 = await searchByTitle(title, author, preferredFormat, baseUrl, undefined, flaresolverrUrl, languageCode);
    if (md5) {
      logger.info(`Found via title: ${md5}`);
    }
  }

  if (!md5) {
    logger.info('No results from Anna\'s Archive');
    return [];
  }

  // Get download links
  const slowLinks = await getSlowDownloadLinks(md5, baseUrl, undefined, flaresolverrUrl);

  if (slowLinks.length === 0) {
    logger.warn(`Found MD5 ${md5} but no download links available`);
    return [];
  }

  // Return as normalized result - always score 100 for Anna's Archive
  const score = 100;

  return [{
    guid: `annas-archive-${md5}`,
    title: `${title} - ${author}`,
    size: 0, // Unknown until download
    seeders: 999, // N/A for direct download, use high number for display
    indexer: "Anna's Archive",
    publishDate: new Date(),
    downloadUrl: slowLinks[0],
    infoUrl: `${baseUrl}/md5/${md5}`,

    score,
    finalScore: score,
    bonusPoints: 0,
    bonusModifiers: [],
    rank: 1,
    breakdown: {
      formatScore: 10,
      sizeScore: 15,
      seederScore: 15,
      matchScore: 60,
      totalScore: score,
      notes: [searchMethod === 'asin' ? 'ASIN match' : 'Title/Author match', "Anna's Archive"],
    },

    source: 'annas_archive',
    format: preferredFormat,
    md5,
    downloadUrls: slowLinks,
  }];
}

/**
 * Search indexers and return ranked results
 */
async function searchIndexersForInteractive(
  title: string,
  author: string,
  preferredFormat: string
): Promise<EbookSearchResult[]> {
  const configService = getConfigService();

  // Get indexer configuration
  const indexersConfigStr = await configService.get('prowlarr_indexers');
  if (!indexersConfigStr) {
    logger.warn('No indexers configured');
    return [];
  }

  const indexersConfig = JSON.parse(indexersConfigStr);
  if (indexersConfig.length === 0) {
    logger.warn('No indexers enabled');
    return [];
  }

  // Build indexer priorities map
  const indexerPriorities = new Map<number, number>(
    indexersConfig.map((indexer: any) => [indexer.id, indexer.priority ?? 10])
  );

  // Get flag configurations
  const flagConfigStr = await configService.get('indexer_flag_config');
  const flagConfigs = flagConfigStr ? JSON.parse(flagConfigStr) : [];

  // Group indexers by ebook categories
  const { groups, skippedIndexers } = groupIndexersByCategories(indexersConfig, 'ebook');

  if (skippedIndexers.length > 0) {
    const skippedNames = skippedIndexers.map(idx => idx.name).join(', ');
    logger.info(`Skipping ${skippedIndexers.length} indexer(s) with no ebook categories: ${skippedNames}`);
  }

  logger.info(`Searching ${indexersConfig.length - skippedIndexers.length} indexers in ${groups.length} group(s)`);

  // Get Prowlarr service
  const prowlarr = await getProwlarrService();

  // Search each group and combine results
  const allResults = [];

  for (const group of groups) {
    try {
      const groupResults = await prowlarr.search(title, {
        categories: group.categories,
        indexerIds: group.indexerIds,
        minSeeders: 0,
        maxResults: 100,
      });
      allResults.push(...groupResults);
    } catch (error) {
      logger.error(`Group search failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  logger.info(`Found ${allResults.length} results from indexers`);

  if (allResults.length === 0) {
    return [];
  }

  // Get language-specific stop words for ranking
  const rankRegion = await configService.getAudibleRegion() as AudibleRegion;
  const rankLangConfig = getLanguageForRegion(rankRegion);

  // Rank results with ebook scoring
  // Use requireAuthor=false for interactive mode (let user decide)
  const rankedResults = rankEbookTorrents(allResults, {
    title,
    author,
    preferredFormat,
  }, {
    indexerPriorities,
    flagConfigs,
    requireAuthor: false,
    stopWords: rankLangConfig.stopWords,
    characterReplacements: rankLangConfig.characterReplacements,
  });

  // Log ranking debug info (same format as search-ebook.processor.ts)
  if (rankedResults.length > 0) {
    const top3 = rankedResults.slice(0, 3);
    logger.info(`==================== EBOOK INTERACTIVE SEARCH DEBUG ====================`);
    logger.info(`Requested Title: "${title}"`);
    logger.info(`Requested Author: "${author}"`);
    logger.info(`Preferred Format: ${preferredFormat}`);
    logger.info(`Top ${top3.length} results (out of ${rankedResults.length} total):`);
    logger.info(`--------------------------------------------------------------`);
    for (let i = 0; i < top3.length; i++) {
      const result = top3[i];
      const sizeMB = (result.size / (1024 * 1024)).toFixed(1);

      logger.info(`${i + 1}. "${result.title}"`);
      logger.info(`   Indexer: ${result.indexer}${result.indexerId ? ` (ID: ${result.indexerId})` : ''}`);
      logger.info(`   Format: ${result.ebookFormat || 'unknown'}`);
      logger.info(``);
      logger.info(`   Base Score: ${result.score.toFixed(1)}/100`);
      logger.info(`   - Title/Author Match: ${result.breakdown.matchScore.toFixed(1)}/60`);
      logger.info(`   - Format Match: ${result.breakdown.formatScore.toFixed(1)}/10`);
      logger.info(`   - Size Quality: ${result.breakdown.sizeScore.toFixed(1)}/15 (${sizeMB} MB)`);
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
        logger.info(`--------------------------------------------------------------`);
      }
    }
    logger.info(`==============================================================`);
  }

  // Convert to unified result type
  return rankedResults.map((result: RankedEbookTorrent): EbookSearchResult => ({
    guid: result.guid,
    title: result.title,
    size: result.size,
    seeders: result.seeders,
    indexer: result.indexer,
    indexerId: result.indexerId,
    publishDate: result.publishDate,
    downloadUrl: result.downloadUrl,
    infoUrl: result.infoUrl,

    score: result.score,
    finalScore: result.finalScore,
    bonusPoints: result.bonusPoints,
    bonusModifiers: result.bonusModifiers,
    rank: result.rank,
    breakdown: result.breakdown,

    source: 'prowlarr',
    format: result.ebookFormat,
    protocol: result.protocol,
  }));
}
