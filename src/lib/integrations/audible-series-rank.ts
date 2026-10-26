/**
 * Component: Audible Series Search Ranking (series from a catalog keyword page)
 * Documentation: documentation/integrations/audible-series-search.md
 */

import { keepsLanguage, type LanguageConfig } from '../constants/language-config';
import { isWordInTitle, normalizeForMatching } from '../utils/match-normalize';
import type { CatalogSeriesEntry } from './audible-series-fill';

export const MAX_SERIES_RESULTS = 15;
const MAX_TAGS = 5;

/** The fields series search reads from a catalog product */
export interface CatalogSeriesProduct {
  asin?: string;
  language?: string;
  product_images?: Record<string, string>;
  category_ladders?: Array<{ ladder?: Array<{ name?: string }> }>;
  series?: CatalogSeriesEntry[];
}

export interface SeriesCandidate {
  asin: string;
  title: string;
  /** Products on the keyword page that list this series */
  productCount: number;
  /** Index of the first product that listed it */
  firstSeen: number;
  /** At least one of its products is in the region's language (or lists none) */
  accepted: boolean;
  coverArtUrl?: string;
  tags: string[];
}

interface Cover {
  url: string;
  accepted: boolean;
  sequence: number;
  index: number;
}

interface Building extends SeriesCandidate {
  cover?: Cover;
  tagCounts: Map<string, number>;
}

function sequenceNumber(sequence: string | undefined): number {
  const match = sequence?.match(/\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : Number.POSITIVE_INFINITY;
}

/** Card cover: an accepted-language product first, then the lowest sequence, then the first seen */
function betterCover(a: Cover, b: Cover | undefined): boolean {
  if (!b) return true;
  if (a.accepted !== b.accepted) return a.accepted;
  if (a.sequence !== b.sequence) return a.sequence < b.sequence;
  return a.index < b.index;
}

/** The most specific genre of each category ladder (its last node) */
function leafGenres(product: CatalogSeriesProduct): string[] {
  const leaves = (product.category_ladders ?? [])
    .map((ladder) => ladder?.ladder?.[ladder.ladder.length - 1]?.name)
    .filter((name): name is string => typeof name === 'string' && name.trim() !== '');
  return [...new Set(leaves)];
}

/**
 * Every series listed by the products of one keyword page, keyed by series ASIN (a product
 * can list several). With `languageFilter`, products in another language are skipped first.
 */
export function aggregateSeries(
  products: CatalogSeriesProduct[],
  langConfig: LanguageConfig,
  { languageFilter = false }: { languageFilter?: boolean } = {},
): SeriesCandidate[] {
  const bySeries = new Map<string, Building>();

  products.forEach((product, index) => {
    const accepted = keepsLanguage(product.language, langConfig);
    if (languageFilter && !accepted) return;
    const genres = leafGenres(product);
    const seen = new Set<string>();

    for (const entry of product.series ?? []) {
      const asin = entry?.asin?.trim();
      const title = entry?.title?.trim();
      if (!asin || !title || seen.has(asin)) continue;
      seen.add(asin);

      let series = bySeries.get(asin);
      if (!series) {
        series = { asin, title, productCount: 0, firstSeen: index, accepted: false, tags: [], tagCounts: new Map() };
        bySeries.set(asin, series);
      }
      series.productCount++;
      series.accepted ||= accepted;

      const url = product.product_images?.['500'];
      if (url) {
        const cover = { url, accepted, sequence: sequenceNumber(entry.sequence), index };
        if (betterCover(cover, series.cover)) series.cover = cover;
      }
      for (const genre of genres) series.tagCounts.set(genre, (series.tagCounts.get(genre) ?? 0) + 1);
    }
  });

  return [...bySeries.values()].map(({ cover, tagCounts, ...series }) => ({
    ...series,
    coverArtUrl: cover?.url,
    // Most frequent first; Map order keeps the first seen first on a tie (stable sort)
    tags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TAGS).map(([name]) => name),
  }));
}

function words(text: string, langConfig: LanguageConfig): string[] {
  return normalizeForMatching(text, langConfig.characterReplacements).split(' ').filter(Boolean);
}

/**
 * Share of the query's words (stop words left out, unless the query has nothing else)
 * found as whole words in the series title. The last word may be the start of a title
 * word, since the page searches while the user is still typing.
 */
export function matchShare(title: string, query: string, langConfig: LanguageConfig): number {
  const all = words(query, langConfig);
  const content = all.filter((word) => !langConfig.stopWords.includes(word));
  const queryWords = content.length > 0 ? content : all;
  if (queryWords.length === 0) return 0;

  const titleWords = words(title, langConfig);
  const normalizedTitle = titleWords.join(' ');
  const last = queryWords.length - 1;
  const found = queryWords.filter(
    (word, i) =>
      isWordInTitle(word, titleWords, normalizedTitle) ||
      (i === last && titleWords.some((titleWord) => titleWord.startsWith(word))),
  ).length;
  return found / queryWords.length;
}

/**
 * Order: match share, then series in the region's language, then products on the page,
 * then first seen. Series that match no query word stay, below every match: they are the
 * whole answer when the query names an author or a book.
 */
export function rankSeries(candidates: SeriesCandidate[], query: string, langConfig: LanguageConfig): SeriesCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, share: matchShare(candidate.title, query, langConfig) }))
    .sort(
      (a, b) =>
        b.share - a.share ||
        Number(b.candidate.accepted) - Number(a.candidate.accepted) ||
        b.candidate.productCount - a.candidate.productCount ||
        a.candidate.firstSeen - b.candidate.firstSeen,
    )
    .slice(0, MAX_SERIES_RESULTS)
    .map(({ candidate }) => candidate);
}
