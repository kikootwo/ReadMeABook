/**
 * Component: Audible Series Scraping
 * Documentation: documentation/integrations/audible.md
 *
 * Standalone series scraping module. Uses the AudibleService fetch wrapper
 * for HTTP requests and Cheerio for HTML parsing.
 * Kept separate from audible.service.ts to avoid bloating the main service.
 *
 * HTML parsing lives in audible-series-parsers.ts (Audible A/B-serves two
 * different series-page layouts; the parsers handle both).
 */

import * as cheerio from 'cheerio';
import { getAudibleService } from './audible.service';
import {
  getLanguageForRegion,
  buildContainsSelector,
} from '../constants/language-config';
import { RMABLogger } from '../utils/logger';
import { randomDelay } from '../utils/scrape-resilience';
import {
  parseSeriesBooks,
  parseSeriesDescription,
  parseSeriesPageSummary,
  parseSimilarSeries,
  type SeriesDetail,
  type SeriesSummary,
} from './audible-series-parsers';

export type {
  SeriesSummary,
  SimilarSeries,
  SeriesDetail,
} from './audible-series-parsers';

const logger = RMABLogger.create('Audible.Series');

const AUDIBLE_PAGE_SIZE = 50;
const MAX_SERIES_RESULTS = 15;

// ---------------------------------------------------------------------------
// Search: extract series links from Audible search results
// ---------------------------------------------------------------------------

/**
 * Search for series by scraping Audible search results and extracting
 * series links. De-duplicates by ASIN, then scrapes each unique series
 * page in parallel (capped at MAX_SERIES_RESULTS).
 */
export async function searchForSeries(query: string): Promise<SeriesSummary[]> {
  const service = getAudibleService();
  const region = service.getRegion();
  const baseUrl = service.getBaseUrl();
  const langConfig = getLanguageForRegion(region);
  const seriesLabels = langConfig.scraping.seriesLabels;

  logger.info(`Searching series for "${query}" (region: ${region})`);

  // Step 1: Fetch search results page
  let $: cheerio.CheerioAPI;
  try {
    const { data: response } = await service.fetch('/search', {
      params: {
        ipRedirectOverride: 'true',
        keywords: query,
        pageSize: AUDIBLE_PAGE_SIZE,
      },
    });
    $ = cheerio.load(response.data);
  } catch (error) {
    logger.error('Series search fetch failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  // Step 2: Extract unique series ASINs from search results
  // Series links appear inside spans containing locale-specific "Series:" text
  const seriesMap = new Map<string, { title: string; coverArtUrl?: string }>();

  $('.s-result-item, .productListItem').each((_index, element) => {
    if (seriesMap.size >= MAX_SERIES_RESULTS) return false;

    const $el = $(element);

    // Find the span containing a series label (e.g. "Series:")
    const seriesSelector = buildContainsSelector('span', seriesLabels);
    const seriesContainer = $el.find(seriesSelector).first();
    if (seriesContainer.length === 0) return;

    // Look for series link within or near the series label container
    // The series link is a child or sibling: <a href="/series/Name/B006K1QER6">
    const parentEl = seriesContainer.parent();
    const seriesLink = parentEl.find('a[href*="/series/"]').first();
    if (seriesLink.length === 0) return;

    const href = seriesLink.attr('href') || '';
    const asinMatch = href.match(/\/series\/[^/]*\/([A-Z0-9]{10})/);
    if (!asinMatch) return;

    const asin = asinMatch[1];
    if (seriesMap.has(asin)) return;

    const title = seriesLink.text().trim();
    if (!title) return;

    // Use the first book's cover as representative image
    const coverArtUrl = $el.find('img').first().attr('src')?.replace(/\._.*_\./, '._SL500_.') || undefined;

    seriesMap.set(asin, { title, coverArtUrl });
  });

  if (seriesMap.size === 0) {
    logger.info(`No series found for "${query}"`);
    return [];
  }

  logger.info(`Found ${seriesMap.size} unique series, scraping detail pages...`);

  // Step 3: Scrape each series page in parallel (with rate limiting)
  const entries = Array.from(seriesMap.entries());
  const BATCH_SIZE = 5;
  const results: SeriesSummary[] = [];

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async ([asin, meta]) => {
        try {
          const detail = await scrapeSeriesPageSummary(asin);
          if (!detail) return null;
          return {
            ...detail,
            coverArtUrl: detail.coverArtUrl || meta.coverArtUrl,
            audibleUrl: `${baseUrl}/series/${asin}`,
          } as SeriesSummary;
        } catch (error) {
          logger.warn(`Failed to scrape series ${asin}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          // Return a minimal result from search data
          return {
            asin,
            title: meta.title,
            bookCount: 0,
            tags: [],
            coverArtUrl: meta.coverArtUrl,
            audibleUrl: `${baseUrl}/series/${asin}`,
          } as SeriesSummary;
        }
      })
    );

    results.push(...batchResults.filter((r): r is SeriesSummary => r !== null));

    // Rate limit between batches
    if (i + BATCH_SIZE < entries.length) {
      await new Promise(resolve => setTimeout(resolve, randomDelay(1500, 3000)));
    }
  }

  logger.info(`Series search complete: "${query}" -> ${results.length} results`);
  return results;
}

// ---------------------------------------------------------------------------
// Series page scraping
// ---------------------------------------------------------------------------

/**
 * Scrape a series page for summary data (title, book count, rating, tags).
 * Used during search to enrich each series result.
 */
async function scrapeSeriesPageSummary(asin: string): Promise<Omit<SeriesSummary, 'audibleUrl'> | null> {
  const service = getAudibleService();

  try {
    const { data: response } = await service.fetch(`/series/${asin}`, {
      params: { ipRedirectOverride: 'true' },
    });
    const $ = cheerio.load(response.data);

    return parseSeriesPageSummary($, asin);
  } catch (error) {
    logger.warn(`Failed to fetch series page ${asin}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Scrape a series page for full detail data including books and similar series.
 * Used by the detail API endpoint.
 */
export async function scrapeSeriesPage(asin: string, page: number = 1): Promise<(SeriesDetail & { hasMore: boolean; page: number }) | null> {
  const service = getAudibleService();
  const region = service.getRegion();
  const baseUrl = service.getBaseUrl();
  const langConfig = getLanguageForRegion(region);

  logger.info(`Scraping series detail page: ${asin}, page ${page}`);

  try {
    const { data: response } = await service.fetch(`/series/${asin}`, {
      params: { ipRedirectOverride: 'true', pageSize: AUDIBLE_PAGE_SIZE, page },
    });
    const $ = cheerio.load(response.data);

    // Parse summary fields
    const summary = parseSeriesPageSummary($, asin);

    const description = parseSeriesDescription($);

    // Parse all books from the series page
    const books = parseSeriesBooks($, langConfig.scraping.authorPrefixes, langConfig.scraping.narratorPrefixes, langConfig);

    // Layout-drift detector: the header says the series has books but no rows
    // parsed, which means Audible changed its markup again.
    if (books.length === 0 && summary.bookCount > 0) {
      logger.warn(
        `Series ${asin} reports ${summary.bookCount} books but no book rows parsed - Audible layout may have changed`,
        {
          modernRows: $('adbl-product-row').length,
          legacyRows: $('.productListItem, .bc-list-item').length,
        },
      );
    }

    // Use actual book count if we got more from scraping
    const bookCount = Math.max(summary.bookCount, books.length);

    // Calculate hasMore: use header bookCount if available, otherwise check if full page
    const hasMore = bookCount > 0
      ? page * AUDIBLE_PAGE_SIZE < bookCount
      : books.length >= AUDIBLE_PAGE_SIZE;

    // Parse similar series ("Listeners also enjoyed" or similar section)
    const similarSeries = parseSimilarSeries($);

    logger.info(`Series detail complete: "${summary.title}" (${books.length} books, page ${page}, hasMore: ${hasMore})`);

    return {
      asin,
      title: summary.title,
      bookCount,
      rating: summary.rating,
      ratingCount: summary.ratingCount,
      description,
      tags: summary.tags,
      books,
      similarSeries,
      audibleUrl: `${baseUrl}/series/${asin}`,
      hasMore,
      page,
    };
  } catch (error) {
    logger.error(`Failed to scrape series detail ${asin}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
