/**
 * Component: Audible Series Page Parsers
 * Documentation: documentation/integrations/audible.md
 *
 * Pure Cheerio parsers for Audible series pages.
 *
 * Audible A/B-serves two different layouts for /series/{asin}:
 *   modern - books in <adbl-product-row> web components inside #series-titles,
 *            each carrying a JSON metadata blob (authors, narrators, duration,
 *            rating, releaseDate). Contains zero legacy classes.
 *   legacy - books in <li class="productListItem"> inside .bc-list-item.
 *
 * The two layouts are disjoint, so every parser here tries modern first and
 * falls back to legacy. Parsing only the legacy layout made series pages come
 * back intermittently empty (blank cover + correct count + no books).
 */

import * as cheerio from 'cheerio';
import type { AudibleAudiobook } from './audible.service';
import {
  buildContainsSelector,
  stripPrefixes,
  type LanguageConfig,
} from '../constants/language-config';
import { parseRuntime } from '../utils/parse-runtime';
import { extractAllNarrators } from '../utils/extract-narrator';

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

/** JSON metadata blob embedded in each modern <adbl-product-row>. */
interface AdblRowMetadata {
  authors?: Array<{ name?: string; url?: string }>;
  narrators?: Array<{ name?: string }>;
  duration?: string;
  language?: string;
  releaseDate?: string;
  rating?: { value?: number; count?: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Upgrade an Audible image URL to the 500px variant. */
function toLargeCover(src?: string): string | undefined {
  return src?.replace(/\._.*_\./, '._SL500_.');
}

/**
 * Select elements outside any product carousel. Carousel entries describe
 * *other* series ("Listeners also enjoyed"), so their counts, ratings and
 * covers must never be mistaken for this series'.
 */
function outsideCarousel($: cheerio.CheerioAPI, selector: string) {
  return $(selector).filter((_i, el) => $(el).closest('adbl-product-carousel').length === 0);
}

// ---------------------------------------------------------------------------
// Book list parsing
// ---------------------------------------------------------------------------

/**
 * Parse all books from a series page, preferring the modern layout.
 * Falls back to the legacy product-list markup when no modern rows exist.
 */
export function parseSeriesBooks(
  $: cheerio.CheerioAPI,
  authorPrefixes: string[],
  narratorPrefixes: string[],
  langConfig: LanguageConfig
): AudibleAudiobook[] {
  const modern = parseModernSeriesBooks($, langConfig);
  if (modern.length > 0) return modern;

  return parseLegacySeriesBooks($, authorPrefixes, narratorPrefixes, langConfig);
}

/** Safely parse a row's embedded JSON metadata blob. */
function parseRowMetadata(json: string): AdblRowMetadata | null {
  if (!json.trim()) return null;
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as AdblRowMetadata) : null;
  } catch {
    return null;
  }
}

/**
 * Modern layout: <adbl-product-row> web components. Metadata comes from an
 * embedded JSON blob, which is structured (real narrator arrays, author ASIN,
 * release date) and needs no prefix stripping.
 */
function parseModernSeriesBooks(
  $: cheerio.CheerioAPI,
  langConfig: LanguageConfig
): AudibleAudiobook[] {
  const books: AudibleAudiobook[] = [];
  const seenAsins = new Set<string>();

  outsideCarousel($, 'adbl-product-row').each((_index, element) => {
    const $el = $(element);

    const asin =
      $el.find('a[href*="/pd/"]').attr('href')?.match(/\/pd\/[^/]+\/([A-Z0-9]{10})/)?.[1] ||
      $el.find('[data-asin]').first().attr('data-asin') ||
      '';
    if (!asin || seenAsins.has(asin)) return;

    const title =
      $el.find('h3[slot="title"] a').first().text().trim() ||
      $el.find('h3[slot="title"]').first().text().trim() ||
      '';
    if (!title) return;

    seenAsins.add(asin);

    const meta = parseRowMetadata($el.find('script[type="application/json"]').first().text());

    // Match legacy behaviour: a single primary author, not a joined list.
    const author = meta?.authors?.find(a => a?.name)?.name?.trim() || '';
    const authorUrl = meta?.authors?.find(a => a?.url)?.url || '';
    const authorAsin = authorUrl.match(/\/author\/[^/]+\/([A-Z0-9]{10})/)?.[1];

    const narrator = (meta?.narrators || [])
      .map(n => n?.name?.trim())
      .filter((n): n is string => Boolean(n))
      .join(', ');

    const rating = typeof meta?.rating?.value === 'number' ? meta.rating.value : undefined;

    books.push({
      asin,
      title,
      author,
      authorAsin,
      narrator: narrator || undefined,
      coverArtUrl: toLargeCover($el.find('adbl-product-image img').first().attr('src')) || '',
      rating,
      durationMinutes: meta?.duration ? parseRuntime(meta.duration, langConfig) : undefined,
      releaseDate: meta?.releaseDate || undefined,
      language: meta?.language || undefined,
    });
  });

  return books;
}

/** Legacy layout: <li class="productListItem"> / .bc-list-item product rows. */
function parseLegacySeriesBooks(
  $: cheerio.CheerioAPI,
  authorPrefixes: string[],
  narratorPrefixes: string[],
  langConfig: LanguageConfig
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

    // Title: h3 a / .bc-heading a hold the real book title;
    // h2 on series pages is the position label ("Book 1"), so try it last.
    const title = $el.find('h3 a').first().text().trim() ||
      $el.find('.bc-heading a').first().text().trim() ||
      $el.find('h2 a').first().text().trim() ||
      $el.find('h2').first().text().trim() ||
      '';

    if (!title) return;

    // Author
    const authorLink = $el.find('a[href*="/author/"]').first();
    const authorText = authorLink.text().trim() ||
      $el.find('.authorLabel').text().trim() ||
      '';
    const authorHref = authorLink.attr('href') || '';
    const authorAsinMatch = authorHref.match(/\/author\/[^/]+\/([A-Z0-9]{10})/);

    // Narrator — capture all narrator links (multi-narrator productions are common)
    const narratorText = extractAllNarrators($, $el);

    // Cover art
    const coverArtUrl = toLargeCover($el.find('img').first().attr('src')) || '';

    // Rating
    const ratingText = $el.find('.ratingsLabel').text().trim() ||
      $el.find('.a-icon-star span').first().text().trim();
    const ratingMatch = ratingText ? ratingText.match(/(\d+[.,]?\d*)/) : null;
    const rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : undefined;

    // Duration
    const runtimeText = $el.find('.runtimeLabel').text().trim() ||
      $el.find(buildContainsSelector('span', langConfig.scraping.lengthLabels)).text().trim();
    const durationMinutes = parseRuntime(runtimeText, langConfig);

    books.push({
      asin: bookAsin,
      title,
      author: stripPrefixes(authorText, authorPrefixes),
      authorAsin: authorAsinMatch?.[1] || undefined,
      narrator: stripPrefixes(narratorText, narratorPrefixes),
      coverArtUrl,
      rating,
      durationMinutes,
    });
  });

  return books;
}

// ---------------------------------------------------------------------------
// Page-level parsing
// ---------------------------------------------------------------------------

/** Parse summary fields from a series page's Cheerio document. */
export function parseSeriesPageSummary(
  $: cheerio.CheerioAPI,
  asin: string
): Omit<SeriesSummary, 'audibleUrl'> {
  // Title - from h1
  const title = $('h1').first().text().trim() || '';

  const bookCount = parseSeriesBookCount($);
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

  // Cover art from the first book image, modern layout first
  const coverArtUrl =
    toLargeCover(outsideCarousel($, 'adbl-product-row').find('adbl-product-image img').first().attr('src')) ||
    toLargeCover($('.productListItem img, .bc-list-item img').first().attr('src')) ||
    undefined;

  return { asin, title, bookCount, rating, ratingCount, tags: tags.slice(0, 5), coverArtUrl };
}

/** Extract how many books the series contains, most specific source first. */
function parseSeriesBookCount($: cheerio.CheerioAPI): number {
  // Modern: <span slot="child">4 books in series</span> in the page header
  const childMatch = outsideCarousel($, 'span[slot="child"]').first().text().trim().match(/(\d+)/);
  if (childMatch) return parseInt(childMatch[1]);

  // Both layouts: <adbl-metadata slot="child-count">4 titles</adbl-metadata>
  let fromMetadata = 0;
  outsideCarousel($, 'adbl-metadata[slot="child-count"]').each((_i, el) => {
    if (fromMetadata > 0) return false;
    const match = $(el).text().trim().match(/(\d+)/);
    if (match) fromMetadata = parseInt(match[1]);
  });
  if (fromMetadata > 0) return fromMetadata;

  // Legacy: "X books/titles/Titel/libros/Bucher" text somewhere on the page
  const countText = $('span:contains("book"), span:contains("title"), span:contains("Titel"), span:contains("libro"), span:contains("Buch"), span:contains("Bücher")')
    .text().trim();
  const countMatch = countText.match(/(\d+)\s*(books?|titles?|Titel|libros?|B(?:uch|ücher))/i);
  if (countMatch) return parseInt(countMatch[1]);

  // Last resort: count the rendered product rows
  return outsideCarousel($, 'adbl-product-row').length ||
    $('.productListItem, .bc-list-item[data-asin]').length;
}

/**
 * Extract rating and rating count from a series page.
 *
 * Modern HTML uses:
 *   <adbl-star-rating slot="rating" value="5" count="13156" aria-label="13,156 ratings">
 * Legacy HTML uses:
 *   <div aria-label="4.5 out of 5 stars" class="bc-review-stars ...">
 *   <span class="series-rating bc-color-secondary">8,704 ratings</span>
 */
function parseSeriesRating($: cheerio.CheerioAPI): { rating?: number; ratingCount?: number } {
  // Modern: numeric attributes on the header star-rating component
  const star = outsideCarousel($, 'adbl-star-rating[slot="rating"]').first();
  if (star.length > 0) {
    const value = parseFloat(star.attr('value') || '');
    const count = parseInt((star.attr('count') || '').replace(/[.,]/g, ''));
    const rating = Number.isFinite(value) ? value : undefined;
    const ratingCount = Number.isFinite(count) ? count : undefined;
    if (rating !== undefined || ratingCount !== undefined) return { rating, ratingCount };
  }

  let rating: number | undefined;
  let ratingCount: number | undefined;

  // Legacy: aria-label on div.bc-review-stars (e.g. "4.5 out of 5 stars")
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

/** Extract the series description, modern layout first. */
export function parseSeriesDescription($: cheerio.CheerioAPI): string | undefined {
  // Modern: <adbl-text-block> inside #series-about. Read only the paragraphs —
  // its [slot="title"] child is a heading, not summary text.
  const modern = $('#series-about adbl-text-block').first();
  if (modern.length > 0) {
    const text = modern.find('p').text().replace(/\s+/g, ' ').trim();
    if (text) return text;
  }

  const legacy = $('.bc-expander-content').first().text().trim() ||
    $('[class*="productPublisherSummary"]').first().text().trim();

  return legacy || undefined;
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
export function parseSimilarSeries($: cheerio.CheerioAPI): SimilarSeries[] {
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
    const coverArtUrl = toLargeCover($el.find('adbl-collection-image img').first().attr('src')) ||
      toLargeCover($el.find('img').first().attr('src')) ||
      undefined;

    similar.push({ asin, title, bookCount, coverArtUrl });
  });

  return similar;
}
