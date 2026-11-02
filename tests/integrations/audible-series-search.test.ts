/**
 * Component: Audible Series Search Tests (catalog calls, book counts, failures, time budget)
 * Documentation: documentation/integrations/audible-series-search.md
 *
 * Catalog answers are trimmed recordings (tests/fixtures/audible-catalog): the US keyword
 * page for "expeditionary force" and a US batch lookup of three series products.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeCatalog,
  hangUntilAborted,
  httpError,
  loadCatalogFixture,
  networkError,
  settleWithClock,
} from '../helpers/fake-audible-catalog';

vi.mock('@/lib/integrations/audible.service', async () => (await import('../helpers/fake-audible-catalog')).audibleServiceModule);

const EF_PAGE = 'us-keywords-expeditionary-force.json';
const SERIES_BATCH = 'us-asins-series-batch.json';
const UNAVAILABLE = { name: 'SeriesSearchUnavailableError' };

async function searchForSeries(query: string) {
  const mod = await import('@/lib/integrations/audible-series');
  return mod.searchForSeries(query);
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  fakeCatalog.reset();
  fakeCatalog.keyword = async () => loadCatalogFixture(EF_PAGE);
  fakeCatalog.batch = async () => loadCatalogFixture(SERIES_BATCH);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('series search catalog calls', () => {
  it('makes one keyword call and one batch call on the catalog API, never the www /search or /series pages', async () => {
    const results = await searchForSeries('  expeditionary force ');

    expect(results).toHaveLength(15);
    expect(fakeCatalog.calls.map((c) => c.url)).toEqual(['/1.0/catalog/products', '/1.0/catalog/products']);
    const [keyword, batch] = fakeCatalog.calls;
    expect(keyword.options).toEqual({ catalog: true });
    expect(keyword.config.params).toEqual({
      keywords: 'expeditionary force',
      num_results: 50,
      response_groups: 'series,media,product_attrs,category_ladders',
    });
    expect(keyword.config.signal).toBeInstanceOf(AbortSignal);
    expect(keyword.config.timeout).toBeGreaterThan(0);
    expect(keyword.config.timeout).toBeLessThanOrEqual(5000);

    expect(batch.options).toEqual({ catalog: true });
    expect(batch.config.params).toEqual({
      asins: results.map((r) => r.asin).join(','),
      num_results: 15,
      response_groups: 'relationships,product_attrs',
    });
    expect(batch.config.signal).toBeInstanceOf(AbortSignal);
    expect(batch.config.timeout).toBeLessThanOrEqual(3000);
  });

  it('reads book counts from the series products\' child relationships only', async () => {
    const results = await searchForSeries('expeditionary force');
    const count = (title: string) => results.find((r) => r.title === title)?.bookCount;

    expect(count('Expeditionary Force')).toBe(22);
    expect(count('Expeditionary Force Mavericks')).toBe(2);
    expect(count('Dungeon Crawler Carl')).toBe(8);
    // Not in the batch answer: no count (badge hidden), never the 1 product on the page
    expect(count('War Core')).toBe(0);
  });

  it('never puts a rating on a search card (the batch lists Dungeon Crawler Carl at 5 stars from one rating)', async () => {
    const batch = loadCatalogFixture(SERIES_BATCH);
    expect(batch.products.find((p: { asin: string }) => p.asin === 'B0937JMKYV').rating.overall_distribution.display_stars).toBe(5);

    const results = await searchForSeries('expeditionary force');

    const carl = results.find((r) => r.asin === 'B0937JMKYV');
    expect(carl).toBeDefined();
    expect(carl?.rating).toBeUndefined();
    expect(carl?.ratingCount).toBeUndefined();
    expect(results.every((r) => r.rating === undefined && r.ratingCount === undefined)).toBe(true);
  });

  it('shows no counts when the batch call fails, still returns the series, and does not retry it', async () => {
    fakeCatalog.batch = async () => {
      throw httpError(503);
    };

    const results = await searchForSeries('expeditionary force');

    expect(results).toHaveLength(15);
    expect(results.every((r) => r.bookCount === 0)).toBe(true);
    expect(fakeCatalog.batchCalls()).toHaveLength(1);
  });

  it('shows no counts when the batch answer has no relationships', async () => {
    fakeCatalog.batch = async () => {
      const batch = loadCatalogFixture(SERIES_BATCH);
      for (const product of batch.products) delete product.relationships;
      return batch;
    };

    const results = await searchForSeries('expeditionary force');

    expect(results[0].title).toBe('Expeditionary Force');
    expect(results.every((r) => r.bookCount === 0)).toBe(true);
  });

  it('guard: a page with no series returns [] without a batch call', async () => {
    // Guard only: also true before the catalog switch
    fakeCatalog.keyword = async () => ({ products: [{ asin: 'B000000001', language: 'english', series: [] }] });

    await expect(searchForSeries('nothing here')).resolves.toEqual([]);
    expect(fakeCatalog.batchCalls()).toHaveLength(0);
  });
});

describe('series search failures', () => {
  it('retries a quick 503 once, then reports Audible unavailable', async () => {
    vi.useFakeTimers();
    fakeCatalog.keyword = async () => {
      throw httpError(503);
    };

    const { outcome } = await settleWithClock(searchForSeries('expeditionary force'), advance);

    expect(outcome?.error).toMatchObject(UNAVAILABLE);
    expect(fakeCatalog.keywordCalls()).toHaveLength(2);
    expect(fakeCatalog.batchCalls()).toHaveLength(0);
  });

  it('returns results when the retry after a 429 succeeds', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    fakeCatalog.keyword = async () => {
      attempt++;
      if (attempt === 1) throw httpError(429);
      return loadCatalogFixture(EF_PAGE);
    };

    const { outcome } = await settleWithClock(searchForSeries('expeditionary force'), advance);

    expect((outcome?.value as unknown[] | undefined)?.length).toBe(15);
    expect(fakeCatalog.keywordCalls()).toHaveLength(2);
  });

  it.each([
    ['403 (blocked)', () => httpError(403)],
    ['404', () => httpError(404)],
    ['an axios timeout', () => networkError('ECONNABORTED')],
    ['a connect timeout', () => networkError('ETIMEDOUT')],
  ])('does not retry after %s and reports Audible unavailable', async (_label, error) => {
    vi.useFakeTimers();
    fakeCatalog.keyword = async () => {
      throw error();
    };

    const { outcome } = await settleWithClock(searchForSeries('expeditionary force'), advance);

    expect(outcome?.error).toMatchObject(UNAVAILABLE);
    expect(fakeCatalog.keywordCalls()).toHaveLength(1);
  });

  it('gives up on a hanging keyword call at its 5 s deadline, with no retry', async () => {
    vi.useFakeTimers();
    fakeCatalog.keyword = hangUntilAborted;

    const search = searchForSeries('expeditionary force');
    const { outcome, elapsedMs } = await settleWithClock(search, advance);

    expect(outcome?.error).toMatchObject(UNAVAILABLE);
    expect(elapsedMs).toBeLessThanOrEqual(5000);
    expect(fakeCatalog.keywordCalls()).toHaveLength(1);
  });

  it('keeps a 503 then a hang inside the one 5 s keyword budget (2 attempts at most)', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    fakeCatalog.keyword = async (call) => {
      attempt++;
      if (attempt === 1) throw httpError(503);
      return hangUntilAborted(call);
    };

    const { outcome, elapsedMs } = await settleWithClock(searchForSeries('expeditionary force'), advance);

    expect(outcome?.error).toMatchObject(UNAVAILABLE);
    expect(elapsedMs).toBeLessThanOrEqual(5000);
    expect(fakeCatalog.keywordCalls()).toHaveLength(2);
  });

  it('finishes within 10 s when the keyword call needs its retry and the batch call hangs', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    fakeCatalog.keyword = async () => {
      attempt++;
      if (attempt === 1) throw networkError('ECONNRESET');
      return loadCatalogFixture(EF_PAGE);
    };
    fakeCatalog.batch = hangUntilAborted;

    const { outcome, elapsedMs } = await settleWithClock(searchForSeries('expeditionary force'), advance);

    const results = outcome?.value as Array<{ bookCount: number }> | undefined;
    expect(results).toHaveLength(15);
    expect(results?.every((r) => r.bookCount === 0)).toBe(true);
    expect(elapsedMs).toBeLessThanOrEqual(10_000);
    expect(fakeCatalog.keywordCalls()).toHaveLength(2);
    expect(fakeCatalog.batchCalls()).toHaveLength(1);
  });

  it('reports Audible unavailable when the answer has no product list', async () => {
    fakeCatalog.keyword = async () => '<html>Service Unavailable</html>';

    await expect(searchForSeries('expeditionary force')).rejects.toMatchObject(UNAVAILABLE);
  });
});
