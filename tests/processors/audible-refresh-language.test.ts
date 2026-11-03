/**
 * Component: Home Rows Language Filter Tests (#259)
 * Documentation: documentation/integrations/audible-language-filter.md
 *
 * Storefront rows carry a "Sprache: Deutsch" style label (recorded /adblbestsellers page
 * from audible.de, 2026-10-27, trimmed to two rows, covers removed). The parser reads it,
 * and the refresh leaves other-language rows out of the home rows while the filter is on.
 * A category whose storefront page is empty falls back to the catalog API (mocked here).
 */

import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const clientMock = vi.hoisted(() => ({ get: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
// Plain holders: the config's mockReset clears vi.fn implementations per test
const state = vi.hoisted(() => ({
  filter: false,
  html: '',
  searchHtml: '',
  catalog: [] as Array<{ asin: string; title: string; language?: string }>,
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ getAudibleRegion: async () => 'de', getAudibleLanguageFilter: async () => state.filter }),
}));
vi.mock('@/lib/services/thumbnail-cache.service', () => ({
  getThumbnailCacheService: () => ({ cacheThumbnail: async () => null, cleanupUnusedThumbnails: async () => 0 }),
}));

// Imported after the mocks are set up (they read prismaMock)
const { getAudibleService } = await import('@/lib/integrations/audible.service');
const { processAudibleRefresh, POPULAR_CATEGORY_ID } = await import('@/lib/processors/audible-refresh.processor');

const PAGE = fs.readFileSync(path.resolve(__dirname, '../fixtures/audible-storefront/de-adblbestsellers.html'), 'utf8');
const [FIRST, SECOND] = ['B0H4Z7JPDG', 'B0GYSTFCYN'];

const savedIn = (categoryId: string) =>
  prismaMock.audibleCacheCategory.create.mock.calls
    .map(([arg]: [{ data: { asin: string; categoryId: string } }]) => arg.data)
    .filter((row: { categoryId: string }) => row.categoryId === categoryId)
    .map((row: { asin: string }) => row.asin);
const savedPopular = () => savedIn(POPULAR_CATEGORY_ID);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  axiosMock.create.mockReturnValue(clientMock);
  state.filter = false;
  state.html = PAGE;
  state.searchHtml = PAGE;
  state.catalog = [];
  clientMock.get.mockImplementation(async (url: string) => {
    if (url === '/1.0/catalog/products') return { status: 200, data: { products: state.catalog }, headers: {} };
    return { status: 200, data: url === '/search' ? state.searchHtml : state.html, headers: {} };
  });
  prismaMock.userHomeSection.findMany.mockResolvedValue([]);
  prismaMock.audibleCache.findMany.mockResolvedValue([]);
  getAudibleService().forceReinitialize();
});

async function refresh() {
  const run = processAudibleRefresh({});
  await vi.runAllTimersAsync();
  await run;
  vi.useRealTimers();
}

describe('storefront row language', () => {
  it('the bestsellers parser reads each row label', async () => {
    const run = getAudibleService().getPopularAudiobooks(2);
    await vi.runAllTimersAsync();
    const books = await run;
    vi.useRealTimers();

    expect(books.map((b) => [b.asin, b.language])).toEqual([[FIRST, 'Deutsch'], [SECOND, 'Deutsch']]);
  });
});

describe('home rows refresh', () => {
  // The recorded page lists only German rows; a row relabelled as an English one
  const relabel = (page: string, asin: string) => {
    const label = page.indexOf('Deutsch', page.indexOf(asin));
    return page.slice(0, label) + 'Englisch' + page.slice(label + 'Deutsch'.length);
  };
  const withEnglishRow = () => relabel(PAGE, SECOND);

  it('off: every row is saved', async () => {
    state.html = withEnglishRow();

    await refresh();

    expect(savedPopular()).toEqual([FIRST, SECOND]);
  });

  it('on: a row listed in another language is left out, a German one kept', async () => {
    state.filter = true;
    state.html = withEnglishRow();

    await refresh();

    expect(savedPopular()).toEqual([FIRST]);
  });

  it('on: a category whose rows are all in another language is replaced, not kept', async () => {
    state.filter = true;
    state.searchHtml = relabel(relabel(PAGE, FIRST), SECOND);
    prismaMock.userHomeSection.findMany.mockResolvedValue([{ categoryId: 'node-de' }]);

    await refresh();

    const wiped = prismaMock.audibleCacheCategory.deleteMany.mock.calls.map(([arg]: [{ where: { categoryId: string } }]) => arg.where.categoryId);
    expect(wiped).toContain('node-de');
    expect(savedIn('node-de')).toEqual([]);
    expect(clientMock.get.mock.calls.some(([url]: [string]) => url === '/1.0/catalog/products')).toBe(false);
  });
});

describe('category catalog fallback', () => {
  // On audible.de the catalog lists German, English and podcast (no language) products
  const catalog = [
    { asin: 'BCATDE0001', title: 'Deutsches Buch', language: 'german' },
    { asin: 'BCATEN0001', title: 'English Book', language: 'english' },
    { asin: 'BCATPOD001', title: 'Ein Podcast' },
    { asin: 'BCATDE0002', title: 'Noch ein Buch', language: 'german' },
  ];

  for (const filter of [false, true]) {
    it(`${filter ? 'on' : 'off'}: an empty storefront page saves the catalog bestsellers in the region language`, async () => {
      state.filter = filter;
      state.searchHtml = '<html><body></body></html>';
      state.catalog = catalog;
      prismaMock.userHomeSection.findMany.mockResolvedValue([{ categoryId: 'node-de' }]);

      await refresh();

      expect(savedIn('node-de')).toEqual(['BCATDE0001', 'BCATDE0002']);
    });
  }
});
