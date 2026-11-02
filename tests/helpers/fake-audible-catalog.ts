/**
 * Component: Fake Audible catalog for series search tests
 * Documentation: documentation/integrations/audible-series-search.md
 *
 * Stands in for getAudibleService(). Answers come from trimmed recordings of the
 * Audible catalog API (tests/fixtures/audible-catalog, recorded 2026-10-26).
 *
 *   vi.mock('@/lib/integrations/audible.service', async () =>
 *     (await import('../helpers/fake-audible-catalog')).audibleServiceModule);
 */

import fs from 'fs';
import path from 'path';

// Recorded JSON that tests read and edit freely
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface CatalogCall {
  url: string;
  config: { params?: Record<string, unknown>; signal?: AbortSignal; timeout?: number };
  options?: { catalog?: boolean };
}

type Handler = (call: CatalogCall) => Promise<Json>;

const FIXTURES = path.resolve(__dirname, '../fixtures/audible-catalog');

/** A recorded catalog answer, parsed fresh on every call (tests may edit it) */
export function loadCatalogFixture(name: string): Json {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

export const fakeCatalog = {
  region: 'us',
  baseUrl: 'https://www.audible.com',
  calls: [] as CatalogCall[],
  keyword: (async () => ({ products: [] })) as Handler,
  batch: (async () => ({ products: [] })) as Handler,
  reset() {
    this.region = 'us';
    this.baseUrl = 'https://www.audible.com';
    this.calls = [];
    this.keyword = async () => ({ products: [] });
    this.batch = async () => ({ products: [] });
  },
  keywordCalls() {
    return this.calls.filter((c) => c.config.params?.keywords !== undefined);
  },
  batchCalls() {
    return this.calls.filter((c) => c.config.params?.asins !== undefined);
  },
};

const fakeService = {
  getRegion: () => fakeCatalog.region,
  getBaseUrl: () => fakeCatalog.baseUrl,
  async fetch(url: string, config: CatalogCall['config'] = {}, options?: CatalogCall['options']) {
    const call = { url, config, options };
    fakeCatalog.calls.push(call);
    const handler = config.params?.asins !== undefined ? fakeCatalog.batch : fakeCatalog.keyword;
    const data = await handler(call);
    // AudibleService.fetch resolves to { data: <axios response>, meta }
    return { data: { status: 200, data }, meta: { retriesUsed: 0, encountered503: false } };
  },
};

export const audibleServiceModule = { getAudibleService: () => fakeService };

/** An axios-shaped HTTP error */
export function httpError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  });
}

/** An axios-shaped network error with no response */
export function networkError(code: string) {
  return Object.assign(new Error(code), { isAxiosError: true, code });
}

/** A request that never answers: it rejects like axios only when its abort signal fires */
export function hangUntilAborted(call: CatalogCall): Promise<never> {
  return new Promise((_resolve, reject) => {
    call.config.signal?.addEventListener('abort', () =>
      reject(Object.assign(new Error('canceled'), { name: 'CanceledError', code: 'ERR_CANCELED' })),
    );
  });
}

/** Advance fake timers in 100 ms steps until the promise settles (or the limit passes) */
export async function settleWithClock<T>(
  promise: Promise<T>,
  advance: (ms: number) => Promise<unknown>,
  limitMs = 20_000,
): Promise<{ outcome?: { value?: T; error?: unknown }; elapsedMs: number }> {
  let outcome: { value?: T; error?: unknown } | undefined;
  promise.then(
    (value) => { outcome = { value }; },
    (error) => { outcome = { error }; },
  );
  let elapsedMs = 0;
  await advance(0);
  while (!outcome && elapsedMs < limitMs) {
    await advance(100);
    elapsedMs += 100;
  }
  return { outcome, elapsedMs };
}
