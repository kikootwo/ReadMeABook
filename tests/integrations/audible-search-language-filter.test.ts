/**
 * Component: Audible Search Language Filter Tests (#259)
 * Documentation: documentation/integrations/audible-language-filter.md
 *
 * search() and GET /api/audiobooks/search against trimmed catalog recordings
 * (tests/fixtures/audible-catalog, recorded 2026-10-27). Off: everything as before the
 * setting existed. On: other-language products are hidden and counted, and paging still
 * follows the raw page, so a fully hidden page is not the last one.
 */

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientMock = vi.hoisted(() => ({ get: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
// Plain holders: the config's mockReset clears vi.fn implementations per test
const state = vi.hoisted(() => ({ region: 'fr', filter: null as string | null }));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    getAudibleRegion: async () => state.region,
    getAudibleLanguageFilter: async () => state.filter === 'true',
  }),
}));
vi.mock('@/lib/middleware/auth', () => ({ getOptionalAuthUser: async () => null }));
vi.mock('@/lib/services/works.service', () => ({
  persistDedupGroups: async () => {},
  collapseByExistingWorks: async (books: unknown[]) => books,
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ enrichAudiobooksWithMatches: async (books: unknown[]) => books }));
vi.mock('@/lib/utils/ignored-audiobooks', () => ({ annotateWithIgnoreStatus: async (books: unknown[]) => books }));

import { AudibleService, getAudibleService } from '@/lib/integrations/audible.service';
import { GET } from '@/app/api/audiobooks/search/route';

type Product = { asin: string; language?: string };
const recording = (name: string): { total_results: number; products: Product[] } =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../fixtures/audible-catalog', name), 'utf8'));

const FR = recording('fr-keywords-six-of-crows.json');
const FR_KEPT = FR.products.filter((p) => !p.language || p.language === 'french').map((p) => p.asin);

function serve(page: { total_results: number; products: Product[] }) {
  clientMock.get.mockResolvedValue({ data: page });
}

async function routeJson(query: string) {
  const res = await GET(new NextRequest(`http://localhost/api/audiobooks/search?q=${encodeURIComponent(query)}&page=1`));
  return res.json();
}

beforeEach(() => {
  axiosMock.create.mockReturnValue(clientMock);
  state.region = 'fr';
  state.filter = null;
  serve(FR);
  getAudibleService().forceReinitialize();
});

describe('search() with the language filter off', () => {
  it.each([[null], ['false']])('setting %s: every product, in catalog order, with the same keys as before', async (value) => {
    state.filter = value;

    const result = await new AudibleService().search('six of crows');

    expect(Object.keys(result)).toEqual(['query', 'results', 'totalResults', 'page', 'hasMore']);
    expect(result.results.map((b) => b.asin)).toEqual(FR.products.map((p) => p.asin));
    expect(result).toMatchObject({ query: 'six of crows', totalResults: 64, page: 1, hasMore: true });
  });

  it('the absent key and "false" give deep-equal results', async () => {
    const absent = await new AudibleService().search('six of crows');
    state.filter = 'false';
    const off = await new AudibleService().search('six of crows');

    expect(off).toStrictEqual(absent);
  });
});

describe('search() with the language filter on', () => {
  beforeEach(() => {
    state.filter = 'true';
  });

  it('fr "six of crows": keeps French and no-language products in order, counts the rest', async () => {
    const result = await new AudibleService().search('six of crows');

    expect(result.results.map((b) => b.asin)).toEqual(FR_KEPT);
    expect(FR_KEPT).toHaveLength(13);
    // The first product is English, so BookDate and shelf sync check titles (pickSearchMatch)
    expect(result.languageFilter).toEqual({ language: 'fr', hiddenCount: 37, firstResultHidden: true });
    expect(result.hasMore).toBe(true);
  });

  it('a page whose products are all hidden still reports more pages', async () => {
    serve({ total_results: 120, products: FR.products.filter((p) => p.language === 'english') });

    const result = await new AudibleService().search('six of crows');

    expect(result.results).toEqual([]);
    expect(result.languageFilter).toEqual({ language: 'fr', hiddenCount: 33, firstResultHidden: true });
    expect(result.hasMore).toBe(true);
  });

  it('without a total, a full raw page that is all hidden still reports more pages', async () => {
    const english = FR.products.filter((p) => p.language === 'english');
    serve({ total_results: 0, products: [...english, ...english].slice(0, 50).map((p, i) => ({ ...p, asin: `B0FULL${String(i).padStart(4, '0')}` })) });

    const result = await new AudibleService().search('six of crows');

    expect(result.results).toEqual([]);
    expect(result.hasMore).toBe(true);
  });

  it('ignoreLanguageFilter (bulk import) gives exactly the off result', async () => {
    const bypassed = await new AudibleService().search('six of crows', 1, { ignoreLanguageFilter: true });
    state.filter = null;
    const off = await new AudibleService().search('six of crows');

    expect(bypassed).toStrictEqual(off);
  });
});

describe('GET /api/audiobooks/search', () => {
  it('off: the response has no new fields', async () => {
    const body = await routeJson('six of crows');

    expect(Object.keys(body)).toEqual(['success', 'query', 'results', 'totalResults', 'page', 'hasMore']);
    expect(body.results).toHaveLength(50);
  });

  it('on: the page carries hiddenCount and the language name', async () => {
    state.filter = 'true';

    const body = await routeJson('six of crows');

    expect(body.results.map((b: { asin: string }) => b.asin)).toEqual(FR_KEPT);
    expect(body).toMatchObject({ hasMore: true, hiddenCount: 37, filterLanguage: 'French' });
  });
});
