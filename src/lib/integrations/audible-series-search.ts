/**
 * Component: Audible Series Search (catalog API)
 * Documentation: documentation/integrations/audible-series-search.md
 *
 * One catalog keyword call finds the series; one batch call by series ASIN reads their
 * book counts. Both run on a short deadline: the user is waiting on the page.
 */

import { getAudibleService } from './audible.service';
import { getLanguageForRegion } from '../constants/language-config';
import { RMABLogger } from '../utils/logger';
import { randomDelay } from '../utils/scrape-resilience';
import { catalogBudget, isAbort, type CatalogFetchProfile, type FetchError } from './audible-series-fill';
import { aggregateSeries, rankSeries, type CatalogSeriesProduct } from './audible-series-rank';
import type { SeriesSummary } from './audible-series-parsers';

const logger = RMABLogger.create('Audible.SeriesSearch');

const CATALOG_PRODUCTS = '/1.0/catalog/products';
const KEYWORD_PAGE_SIZE = 50;
const KEYWORD_RESPONSE_GROUPS = 'series,media,product_attrs,category_ladders';
const BATCH_RESPONSE_GROUPS = 'relationships,product_attrs';

/** Keyword call: 5 s in total, one retry after a quick 429, 5xx or network failure */
export const SERIES_SEARCH_KEYWORD_PROFILE: CatalogFetchProfile = { maxRetries: 1, deadlineMs: 5000, onFailure: 'throw' };
/** Book counts: one attempt within 3 s; without them the cards show no count */
export const SERIES_SEARCH_BATCH_PROFILE: CatalogFetchProfile = { maxRetries: 0, deadlineMs: 3000, onFailure: 'log' };
const RETRY_PAUSE_MIN_MS = 250;
const RETRY_PAUSE_MAX_MS = 500;
/** A retry needs at least this much of the budget left after its pause */
const MIN_RETRY_WINDOW_MS = 1500;

/** The Audible catalog didn't answer the series search (the route reports it as a 502) */
export class SeriesSearchUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`Audible catalog unavailable for series search: ${reason}`);
    this.name = 'SeriesSearchUnavailableError';
  }
}

class CatalogCallError extends Error {
  constructor(readonly reason: string, readonly attempts: number) {
    super(reason);
  }
}

interface CatalogRelationship {
  asin?: string;
  relationship_to_product?: string;
  relationship_type?: string;
}

interface CatalogBatchProduct {
  asin?: string;
  relationships?: CatalogRelationship[];
}

function failureReason(error: FetchError): string {
  const status = error.response?.status;
  if (typeof status === 'number') return `HTTP ${status}`;
  if (isAbort(error)) return 'timeout';
  return typeof error.message === 'string' && error.message ? error.message : String(error);
}

/** Worth one more try: a 429, a 5xx, or a network error that was not a timeout or abort */
function isQuickFailure(error: FetchError): boolean {
  if (isAbort(error)) return false;
  const status = error.response?.status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  return typeof error.code === 'string';
}

/** One catalog `/products` GET within the profile's budget; the budget covers every attempt */
async function catalogGet(params: Record<string, string | number>, profile: CatalogFetchProfile): Promise<unknown> {
  const service = getAudibleService();
  const budget = catalogBudget(profile.deadlineMs ?? 5000);
  let attempts = 0;
  try {
    for (;;) {
      attempts++;
      try {
        const { data: response } = await service.fetch(
          CATALOG_PRODUCTS,
          { params, signal: budget.signal, timeout: Math.max(1, budget.remainingMs()) },
          { catalog: true },
        );
        return response?.data;
      } catch (caught) {
        const error = (caught ?? {}) as FetchError;
        const pause = randomDelay(RETRY_PAUSE_MIN_MS, RETRY_PAUSE_MAX_MS);
        const retry =
          attempts <= profile.maxRetries &&
          !budget.signal.aborted &&
          isQuickFailure(error) &&
          budget.remainingMs() >= pause + MIN_RETRY_WINDOW_MS;
        if (!retry) throw new CatalogCallError(failureReason(error), attempts);
        await new Promise((resolve) => setTimeout(resolve, pause));
      }
    }
  } finally {
    budget.done();
  }
}

/** Book count per series ASIN, from the series products' child relationships */
async function fetchBookCounts(seriesAsins: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    const envelope = (await catalogGet(
      { asins: seriesAsins.join(','), num_results: seriesAsins.length, response_groups: BATCH_RESPONSE_GROUPS },
      SERIES_SEARCH_BATCH_PROFILE,
    )) as { products?: CatalogBatchProduct[] } | undefined;

    for (const product of Array.isArray(envelope?.products) ? envelope.products : []) {
      if (!product?.asin || !Array.isArray(product.relationships)) continue;
      const books = new Set(
        product.relationships
          .filter((r) => r?.relationship_to_product === 'child' && r.relationship_type === 'series' && r.asin)
          .map((r) => r.asin),
      );
      counts.set(product.asin, books.size);
    }
  } catch (caught) {
    const reason = caught instanceof CatalogCallError ? caught.reason : String(caught);
    logger.warn(`Series book counts unavailable (${reason}); the cards show no count`);
  }
  return counts;
}

/**
 * Series matching a query, best match first (at most 15). Throws
 * SeriesSearchUnavailableError when the catalog keyword call fails.
 * `languageFilter` (the admin language filter) drops products in other languages;
 * without it they only rank lower.
 */
export async function searchForSeries(
  query: string,
  { languageFilter = false }: { languageFilter?: boolean } = {},
): Promise<SeriesSummary[]> {
  const keywords = query.trim();
  if (!keywords) return [];

  let envelope: { products?: unknown } | undefined;
  try {
    envelope = (await catalogGet(
      { keywords, num_results: KEYWORD_PAGE_SIZE, response_groups: KEYWORD_RESPONSE_GROUPS },
      SERIES_SEARCH_KEYWORD_PROFILE,
    )) as { products?: unknown } | undefined;
  } catch (caught) {
    const reason = caught instanceof CatalogCallError ? caught.reason : String(caught);
    const attempts = caught instanceof CatalogCallError ? caught.attempts : 1;
    logger.warn(`Series search for "${keywords}" failed: Audible catalog ${reason} (${attempts} attempt${attempts === 1 ? '' : 's'})`);
    throw new SeriesSearchUnavailableError(reason);
  }
  if (!Array.isArray(envelope?.products)) {
    logger.warn(`Series search for "${keywords}" failed: the Audible catalog answer had no product list`);
    throw new SeriesSearchUnavailableError('unexpected response');
  }

  // Read after the call: the first fetch initializes the service for the configured region
  const service = getAudibleService();
  const region = service.getRegion();
  const baseUrl = service.getBaseUrl();
  const langConfig = getLanguageForRegion(region);

  const products = envelope.products as CatalogSeriesProduct[];
  const ranked = rankSeries(aggregateSeries(products, langConfig, { languageFilter }), keywords, langConfig);
  if (ranked.length === 0) {
    logger.info(`No series found for "${keywords}" (region: ${region}, ${products.length} products)`);
    return [];
  }

  const bookCounts = await fetchBookCounts(ranked.map((series) => series.asin));
  logger.info(`Series search complete: "${keywords}" -> ${ranked.length} results (region: ${region})`);

  return ranked.map((series) => ({
    asin: series.asin,
    title: series.title,
    bookCount: bookCounts.get(series.asin) ?? 0,
    tags: series.tags,
    coverArtUrl: series.coverArtUrl,
    audibleUrl: `${baseUrl}/series/${series.asin}`,
  }));
}
