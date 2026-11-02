/**
 * Component: Home Rows Language Filter Tests (#259)
 * Documentation: documentation/integrations/audible-language-filter.md
 *
 * Storefront rows carry a "Sprache: Deutsch" style label (recorded /adblbestsellers page
 * from audible.de, 2026-10-27, trimmed to two rows, covers removed). The parser reads it,
 * and the refresh leaves other-language rows out of the home rows while the filter is on.
 */

import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const clientMock = vi.hoisted(() => ({ get: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
// Plain holders: the config's mockReset clears vi.fn implementations per test
const state = vi.hoisted(() => ({ filter: false, html: '' }));

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

const savedPopular = () =>
  prismaMock.audibleCacheCategory.create.mock.calls
    .map(([arg]: [{ data: { asin: string; categoryId: string } }]) => arg.data)
    .filter((row: { categoryId: string }) => row.categoryId === POPULAR_CATEGORY_ID)
    .map((row: { asin: string }) => row.asin);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  axiosMock.create.mockReturnValue(clientMock);
  state.filter = false;
  state.html = PAGE;
  clientMock.get.mockImplementation(async () => ({ status: 200, data: state.html, headers: {} }));
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
  // The recorded page lists only German rows; the second row relabelled as an English one
  const withEnglishRow = () => {
    const second = PAGE.indexOf(SECOND);
    const label = PAGE.indexOf('Deutsch', second);
    return PAGE.slice(0, label) + 'Englisch' + PAGE.slice(label + 'Deutsch'.length);
  };

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
});
