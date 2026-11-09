/**
 * Component: Audible Series Scraping
 * Documentation: documentation/integrations/audible.md
 *
 * Series detail pages (/series/{asin}) scraped through the AudibleService HTML fetch
 * wrapper and parsed with Cheerio. Series search uses the catalog API instead
 * (audible-series-search.ts) and is re-exported here.
 *
 * HTML parsing lives in audible-series-parsers.ts (Audible A/B-serves two
 * different series-page layouts; the parsers handle both).
 */

import * as cheerio from 'cheerio';
import { getAudibleService } from './audible.service';
import { getLanguageForRegion, partitionByLanguage } from '../constants/language-config';
import { RMABLogger } from '../utils/logger';
import { isLanguageFilterOn, type LanguageFilterInfo } from './audible-language-filter';
import {
  parseSeriesBooks,
  parseSeriesDescription,
  parseSeriesPageSummary,
  parseSimilarSeries,
  type SeriesDetail,
} from './audible-series-parsers';

export type {
  SeriesSummary,
  SimilarSeries,
  SeriesDetail,
} from './audible-series-parsers';
export { searchForSeries, searchSeries, SeriesSearchUnavailableError } from './audible-series-search';

const logger = RMABLogger.create('Audible.Series');

const AUDIBLE_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Series page scraping
// ---------------------------------------------------------------------------

/** Set only while the admin language filter is on */
export interface SeriesPageLanguageFilter {
  /** Book rows on the page before the filter (paging and caps count these) */
  rawCount?: number;
  languageFilter?: LanguageFilterInfo;
}

/**
 * Scrape a series page for full detail data including books and similar series.
 * Used by the detail API endpoint. Counts, paging and the drift warning come from the
 * rows as listed; the admin language filter then hides other-language rows.
 */
export async function scrapeSeriesPage(
  asin: string,
  page: number = 1,
): Promise<(SeriesDetail & SeriesPageLanguageFilter & { hasMore: boolean; page: number }) | null> {
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

    const filterOn = await isLanguageFilterOn();
    const { kept, hidden } = filterOn
      ? partitionByLanguage(books, (book) => book.language, langConfig)
      : { kept: books, hidden: [] };

    logger.info(`Series detail complete: "${summary.title}" (${kept.length} books, page ${page}, hasMore: ${hasMore})`);

    return {
      asin,
      title: summary.title,
      bookCount,
      rating: summary.rating,
      ratingCount: summary.ratingCount,
      description,
      tags: summary.tags,
      books: kept,
      similarSeries,
      audibleUrl: `${baseUrl}/series/${asin}`,
      hasMore,
      page,
      ...(filterOn && { rawCount: books.length, languageFilter: { language: langConfig.code, hiddenCount: hidden.length } }),
    };
  } catch (error) {
    logger.error(`Failed to scrape series detail ${asin}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
