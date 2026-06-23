/**
 * Component: Series Bundle Detection & Decomposition
 * Documentation: documentation/features/series-bundle-decomposition.md
 *
 * Recognizes when a requested "audiobook" is actually a multi-book series
 * bundle (e.g. "Mistborn Trilogy", "The Complete Dune Saga") and enumerates the
 * individual books in that series so the caller can fan out per-book requests
 * instead of trying — and failing — to download the bundle as one item.
 *
 * Pure detection lives here (no DB, no request creation) to keep it testable and
 * to avoid a circular dependency with request-creator.service.ts, which owns the
 * orchestration/fan-out.
 */

import { scrapeSeriesPage } from '@/lib/integrations/audible-series';
import { RMABLogger } from '@/lib/utils/logger';
import type { CreateRequestInput } from '@/lib/services/request-creator.service';

const logger = RMABLogger.create('SeriesBundle');

/** Runtime (minutes) above which a weak title keyword is treated as a bundle. ~30h. */
const LONG_RUNTIME_MIN = 1800;
/** Hard cap on how many books a single bundle may fan out into (runaway guard). */
const MAX_BUNDLE_BOOKS = 30;
/** Max series-detail pages to scrape when enumerating books. */
const MAX_SERIES_PAGES = 5;

/**
 * Strong bundle signals — a match alone (with a seriesAsin) is enough.
 * These rarely appear in standalone book titles.
 */
const STRONG_BUNDLE_RE =
  /\b(box\s?sets?|omnibus|trilogy|tetralogy|pentalogy|the\s+complete|complete\s+series|complete\s+collection|books?\s*\d+\s*[-–—]\s*\d+|volumes?\s*\d+\s*[-–—]\s*\d+|vol\.?\s*\d+\s*[-–—]\s*\d+)\b/i;

/**
 * Weak bundle signals — ambiguous (also appear in legit single titles), so they
 * only count as a bundle when corroborated by a long runtime.
 */
const WEAK_BUNDLE_RE = /\b(collection|anthology|compendium|bundle|complete\s+saga)\b/i;

export interface BundleDetectionInput {
  title: string;
  seriesPart?: string;
  seriesAsin?: string;
  durationMinutes?: number;
}

export interface BundleDetectionResult {
  isBundle: boolean;
  /** Numeric position range the bundle covers, when known (e.g. [1, 3]). */
  range?: [number, number];
}

/**
 * Parse a position range string like "1-3", "1 – 7" into a numeric tuple.
 * Returns null for single positions ("1") or unparseable input.
 */
function parseRange(value?: string): [number, number] | null {
  if (!value) return null;
  const match = value.match(/(\d+)\s*[-–—]\s*(\d+)/);
  if (!match) return null;
  const lo = parseInt(match[1], 10);
  const hi = parseInt(match[2], 10);
  if (isNaN(lo) || isNaN(hi) || hi < lo) return null;
  return [lo, hi];
}

/** First numeric position in a seriesPart value ("1", "1-3", "Book 2" → 1/1/2). */
function firstPosition(value?: string): number | null {
  if (!value) return null;
  const match = value.match(/\d+/);
  if (!match) return null;
  const n = parseInt(match[0], 10);
  return isNaN(n) ? null : n;
}

/**
 * Derive a [1, N] range from an "-logy" bundle keyword that implies a fixed
 * book count ("trilogy" → [1, 3]). Used for bundles like "Mistborn Trilogy"
 * that have no explicit numeric range — without this they would enumerate the
 * entire series. Open-ended keywords ("complete", "omnibus", "box set",
 * "collection") deliberately return null so they still grab the whole series.
 */
function keywordRange(title: string): [number, number] | null {
  const counts: Record<string, number> = { trilogy: 3, tetralogy: 4, pentalogy: 5 };
  for (const [word, count] of Object.entries(counts)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(title)) return [1, count];
  }
  return null;
}

/**
 * Decide whether a requested item is a series bundle that should be split.
 *
 * Requires a `seriesAsin` (without it we cannot enumerate the real per-book
 * ASINs, so there is nothing actionable to do).
 */
export function detectBundle(input: BundleDetectionInput): BundleDetectionResult {
  const { title, seriesPart, seriesAsin, durationMinutes } = input;

  // No series to enumerate → nothing we can decompose into.
  if (!seriesAsin) return { isBundle: false };

  // Strongest signal: the product itself spans multiple series positions.
  const partRange = parseRange(seriesPart);
  if (partRange) {
    return { isBundle: true, range: partRange };
  }

  const titleRange = parseRange(title);

  if (STRONG_BUNDLE_RE.test(title)) {
    // Explicit numeric range wins; otherwise infer from an "-logy" keyword
    // (e.g. "Mistborn Trilogy" → [1, 3]) so we don't request the whole series.
    return { isBundle: true, range: titleRange ?? keywordRange(title) ?? undefined };
  }

  if (WEAK_BUNDLE_RE.test(title) && (durationMinutes ?? 0) >= LONG_RUNTIME_MIN) {
    return { isBundle: true, range: titleRange ?? undefined };
  }

  return { isBundle: false };
}

/**
 * Enumerate the individual books of a series for fan-out.
 *
 * - Scrapes the Audible series page(s) for `seriesAsin`.
 * - When `range` is provided, keeps only books whose position falls within it
 *   (books with an unknown position are excluded so we don't over-request).
 * - Excludes the bundle's own ASIN and any nested bundle-looking items.
 * - De-duplicates by ASIN and caps the result at MAX_BUNDLE_BOOKS.
 *
 * Returns an empty array if the series cannot be scraped (caller should then
 * fall back to its normal single-request behaviour).
 */
export async function enumerateSeriesBooks(
  seriesAsin: string,
  range?: [number, number],
  excludeAsin?: string
): Promise<CreateRequestInput[]> {
  const collected: CreateRequestInput[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_SERIES_PAGES; page++) {
    let detail;
    try {
      detail = await scrapeSeriesPage(seriesAsin, page);
    } catch (error) {
      logger.warn(`Failed to scrape series ${seriesAsin} page ${page}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
    if (!detail || detail.books.length === 0) break;

    for (const book of detail.books) {
      if (!book.asin || seen.has(book.asin)) continue;
      if (excludeAsin && book.asin === excludeAsin) continue;
      seen.add(book.asin);

      // Skip nested bundle-looking items (e.g. a box set listed within the series).
      if (STRONG_BUNDLE_RE.test(book.title) || parseRange(book.seriesPart)) continue;

      // Range narrowing: require a known, in-range position.
      if (range) {
        const pos = firstPosition(book.seriesPart);
        if (pos === null || pos < range[0] || pos > range[1]) continue;
      }

      collected.push({
        asin: book.asin,
        title: book.title,
        author: book.author,
        narrator: book.narrator,
        coverArtUrl: book.coverArtUrl,
      });

      if (collected.length >= MAX_BUNDLE_BOOKS) {
        logger.warn(`Series ${seriesAsin} hit MAX_BUNDLE_BOOKS cap (${MAX_BUNDLE_BOOKS})`);
        return collected;
      }
    }

    if (!detail.hasMore) break;
  }

  return collected;
}
