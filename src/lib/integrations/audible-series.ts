/**
 * Component: Audible Series Scraping
 * Documentation: documentation/integrations/audible.md
 *
 * Standalone series scraping module. Uses the AudibleService fetch wrapper
 * for HTTP requests and Cheerio for HTML parsing.
 * Kept separate from audible.service.ts to avoid bloating the main service.
 */

import * as cheerio from 'cheerio';
import { getAudibleService, AudibleAudiobook } from './audible.service';
import { AUDIBLE_REGIONS } from '../types/audible';
import {
  getLanguageForRegion,
  buildContainsSelector,
  stripPrefixes,
} from '../constants/language-config';
import { RMABLogger } from '../utils/logger';
import { randomDelay } from '../utils/scrape-resilience';

const logger = RMABLogger.create('Audible.Series');

const AUDIBLE_PAGE_SIZE = 50;
const MAX_SERIES_RESULTS = 15;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeriesSummary {
  asin: string;
  title: string;
  bookCount: number;
  rating?: number;
  ratingCount?: number;
  tags: string[];
  coverArtUrl?: string;
  audibleUrl: string;
}

export interface SimilarSeries {
  asin: string;
  title: string;
  bookCount?: number;
  coverArtUrl?: string;
}

export interface SeriesDetail {
  asin: string;
  title: string;
  bookCount: number;
  rating?: number;
  ratingCount?: number;
  description?: string;
  tags: string[];
  books: AudibleAudiobook[];
  similarSeries: SimilarSeries[];
  audibleUrl: string;
}

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
// Series page scraping (summary - for search results)
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
 * Parse summary fields from a series page's Cheerio document.
 */
function parseSeriesPageSummary(
  $: cheerio.CheerioAPI,
  asin: string
): Omit<SeriesSummary, 'audibleUrl'> {
  // Title - from h1
  const title = $('h1').first().text().trim() || '';

  // Book count - multiple strategies, most specific first
  let bookCount = 0;

  // Primary: adbl-metadata[slot="child-count"] in the page header (NOT inside carousels)
  // Filter out carousel items by excluding those inside adbl-product-carousel
  $('adbl-metadata[slot="child-count"]').each((_i, el) => {
    if (bookCount > 0) return false;
    const $el = $(el);
    // Skip if inside a carousel (those are similar-series counts)
    if ($el.closest('adbl-product-carousel').length > 0) return;
    const text = $el.text().trim();
    const match = text.match(/(\d+)/);
    if (match) bookCount = parseInt(match[1]);
  });

  // Secondary: text matching in spans/headings for "X books/titles/Titel/libros/Bucher"
  if (bookCount === 0) {
    const countText = $('span:contains("book"), span:contains("title"), span:contains("Titel"), span:contains("libro"), span:contains("Buch"), span:contains("B\u00fccher")')
      .text().trim();
    const countMatch = countText.match(/(\d+)\s*(books?|titles?|Titel|libros?|B(?:uch|\u00fccher))/i);
    if (countMatch) {
      bookCount = parseInt(countMatch[1]);
    }
  }

  // Fallback: count product items on the page
  if (bookCount === 0) {
    bookCount = $('.productListItem, .bc-list-item[data-asin]').length;
  }

  // Rating
  const { rating, ratingCount } = parseSeriesRating($);

  // Tags/genres: primary from adbl-chip web components, fallback to legacy links
  const tags: string[] = [];
  const addTag = (text: string) => {
    const tag = text.trim();
    if (tag && tag.length >= 2 && tag.length <= 50 && !tags.includes(tag)) {
      tags.push(tag);
    }
  };

  // Primary: adbl-chip.related-tag elements (modern Audible layout)
  $('adbl-chip.related-tag').each((_i, el) => {
    addTag($(el).text());
  });

  // Fallback: legacy category and tag links
  if (tags.length === 0) {
    $('a[href*="/cat/"], a[href*="/tag/"]').each((_i, el) => {
      addTag($(el).text());
    });
  }

  // Cover art from first book image
  const coverArtUrl = $('.productListItem img, .bc-list-item img').first()
    .attr('src')?.replace(/\._.*_\./, '._SL500_.') || undefined;

  return { asin, title, bookCount, rating, ratingCount, tags: tags.slice(0, 5), coverArtUrl };
}

// ---------------------------------------------------------------------------
// Series page scraping (full detail)
// ---------------------------------------------------------------------------

/**
 * Scrape a series page for full detail data including books and similar series.
 * Used by the detail API endpoint.
 */
export async function scrapeSeriesPage(asin: string): Promise<SeriesDetail | null> {
  const service = getAudibleService();
  const region = service.getRegion();
  const baseUrl = service.getBaseUrl();
  const langConfig = getLanguageForRegion(region);

  logger.info(`Scraping series detail page: ${asin}`);

  try {
    const { data: response } = await service.fetch(`/series/${asin}`, {
      params: { ipRedirectOverride: 'true', pageSize: AUDIBLE_PAGE_SIZE },
    });
    const $ = cheerio.load(response.data);

    // Parse summary fields
    const summary = parseSeriesPageSummary($, asin);

    // Description
    const description = $('.bc-expander-content').first().text().trim() ||
      $('[class*="productPublisherSummary"]').first().text().trim() ||
      undefined;

    // Parse all books from the series page
    const books = parseSeriesBooks($, langConfig.scraping.authorPrefixes, langConfig.scraping.narratorPrefixes);

    // Use actual book count if we got more from scraping
    const bookCount = Math.max(summary.bookCount, books.length);

    // Parse similar series ("Listeners also enjoyed" or similar section)
    const similarSeries = parseSimilarSeries($);

    logger.info(`Series detail complete: "${summary.title}" (${books.length} books, ${similarSeries.length} similar)`);

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
    };
  } catch (error) {
    logger.error(`Failed to scrape series detail ${asin}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract rating and rating count from a series page.
 *
 * Real HTML uses:
 *   <div aria-label="4.5 out of 5 stars" class="bc-review-stars ...">
 *   <span class="series-rating bc-color-secondary">8,704 ratings</span>
 */
function parseSeriesRating($: cheerio.CheerioAPI): { rating?: number; ratingCount?: number } {
  let rating: number | undefined;
  let ratingCount: number | undefined;

  // Primary: aria-label on div.bc-review-stars (e.g. "4.5 out of 5 stars")
  const starsDiv = $('div.bc-review-stars');
  let ariaLabel = starsDiv.attr('aria-label') || '';

  // Fallback: any element with aria-label containing rating pattern
  if (!ariaLabel) {
    const fallbackEl = $('[aria-label*="out of"], [aria-label*="von 5"], [aria-label*="de 5"]').first();
    ariaLabel = fallbackEl.attr('aria-label') || '';
  }

  // Extract numeric rating from aria-label (handles "4.5 out of 5", "4,5 von 5", "4,5 de 5")
  const ratingMatch = ariaLabel.match(/(\d+[.,]?\d*)\s*(?:out of|von|de)\s*5/i);
  if (ratingMatch) {
    rating = parseFloat(ratingMatch[1].replace(',', '.'));
  }

  // Rating count from span.series-rating (e.g. "8,704 ratings")
  const seriesRatingSpan = $('span.series-rating').first();
  let countText = seriesRatingSpan.text().trim();

  // Fallback: look in broader context for rating count text
  if (!countText) {
    const fallbackContainer = $('[class*="rating"], .ratingsLabel').first();
    countText = fallbackContainer.text().trim();
  }

  const countMatch = countText.match(/([\d,.]+)\s*(?:ratings?|Bewertungen?|calificaciones?)/i);
  if (countMatch) {
    ratingCount = parseInt(countMatch[1].replace(/[.,]/g, ''));
  }

  return { rating, ratingCount };
}

/**
 * Parse all books from a series page's product list items.
 */
function parseSeriesBooks(
  $: cheerio.CheerioAPI,
  authorPrefixes: string[],
  narratorPrefixes: string[]
): AudibleAudiobook[] {
  const books: AudibleAudiobook[] = [];
  const seenAsins = new Set<string>();

  $('.productListItem, .bc-list-item').each((_index, element) => {
    const $el = $(element);

    // Extract ASIN
    const bookAsin = $el.attr('data-asin') ||
      $el.find('li').attr('data-asin') ||
      $el.find('a[href*="/pd/"]').attr('href')?.match(/\/pd\/[^/]+\/([A-Z0-9]{10})/)?.[1] ||
      $el.find('a[href*="/ac/"]').attr('href')?.match(/\/ac\/[^/]+\/([A-Z0-9]{10})/)?.[1] ||
      $el.find('a').attr('href')?.match(/\/(?:pd|ac)\/[^/]+\/([A-Z0-9]{10})/)?.[1] || '';

    if (!bookAsin || seenAsins.has(bookAsin)) return;
    seenAsins.add(bookAsin);

    // Title
    const title = $el.find('h2').first().text().trim() ||
      $el.find('h3 a').first().text().trim() ||
      $el.find('.bc-heading a').first().text().trim() ||
      '';

    if (!title) return;

    // Author
    const authorLink = $el.find('a[href*="/author/"]').first();
    const authorText = authorLink.text().trim() ||
      $el.find('.authorLabel').text().trim() ||
      '';
    const authorHref = authorLink.attr('href') || '';
    const authorAsinMatch = authorHref.match(/\/author\/[^/]+\/([A-Z0-9]{10})/);

    // Narrator
    const narratorText = $el.find('a[href*="searchNarrator="]').first().text().trim() ||
      $el.find('.narratorLabel').text().trim() ||
      '';

    // Cover art
    const coverArtUrl = $el.find('img').first().attr('src')?.replace(/\._.*_\./, '._SL500_.') || '';

    // Rating
    const ratingText = $el.find('.ratingsLabel').text().trim() ||
      $el.find('.a-icon-star span').first().text().trim();
    const ratingMatch = ratingText ? ratingText.match(/(\d+[.,]?\d*)/) : null;
    const rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : undefined;

    books.push({
      asin: bookAsin,
      title,
      author: stripPrefixes(authorText, authorPrefixes),
      authorAsin: authorAsinMatch?.[1] || undefined,
      narrator: stripPrefixes(narratorText, narratorPrefixes),
      coverArtUrl,
      rating,
    });
  });

  return books;
}

/**
 * Parse similar series from the "Listeners also enjoyed" carousel.
 *
 * Real HTML uses web components:
 *   <adbl-product-carousel id="SeriestoSeries">
 *     <adbl-product-grid-item>
 *       <div class="adbl-impression-emitted" data-asin="B0CGS1LPWJ">
 *       <adbl-metadata slot="title"><a>Hockey Guys</a></adbl-metadata>
 *       <adbl-metadata slot="child-count">3 titles</adbl-metadata>
 *     </adbl-product-grid-item>
 */
function parseSimilarSeries($: cheerio.CheerioAPI): SimilarSeries[] {
  const similar: SimilarSeries[] = [];
  const seenAsins = new Set<string>();

  // Scope to the SeriestoSeries carousel to avoid picking up other series links
  const carousel = $('adbl-product-carousel#SeriestoSeries');
  if (carousel.length === 0) return similar;

  carousel.find('adbl-product-grid-item').each((_i, el) => {
    if (similar.length >= 15) return false;

    const $el = $(el);

    // Extract ASIN: prefer data-asin on impression div, fallback to series href
    let asin = $el.find('.adbl-impression-emitted, .adbl-asin-impression').first().attr('data-asin') || '';
    if (!asin) {
      const seriesHref = $el.find('a[href*="/series/"]').first().attr('href') || '';
      const hrefMatch = seriesHref.match(/\/series\/[^/]*\/([A-Z0-9]{10})/);
      if (hrefMatch) asin = hrefMatch[1];
    }
    if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) return;
    if (seenAsins.has(asin)) return;
    seenAsins.add(asin);

    // Title from metadata slot
    const title = $el.find('adbl-metadata[slot="title"] a').first().text().trim() ||
      $el.find('adbl-metadata[slot="title"]').first().text().trim() || '';
    if (!title || title.length > 200) return;

    // Book count from child-count slot (e.g. "3 titles")
    const countText = $el.find('adbl-metadata[slot="child-count"]').first().text().trim();
    const countMatch = countText.match(/(\d+)/);
    const bookCount = countMatch ? parseInt(countMatch[1]) : undefined;

    // Cover image from adbl-collection-image
    const coverArtUrl = $el.find('adbl-collection-image img').first().attr('src')?.replace(/\._.*_\./, '._SL500_.') ||
      $el.find('img').first().attr('src')?.replace(/\._.*_\./, '._SL500_.') ||
      undefined;

    similar.push({ asin, title, bookCount, coverArtUrl });
  });

  return similar;
}
