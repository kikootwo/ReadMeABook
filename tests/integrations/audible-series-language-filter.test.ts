/**
 * Component: Series Page Language Filter Tests (#259)
 * Documentation: documentation/integrations/audible-language-filter.md
 *
 * scrapeSeriesPage counts and pages on the rows as listed, then hides other-language
 * rows. A full page with one hidden row, or a fully hidden page, must not end paging for
 * the detail page or for watched series (the #310 class of bug).
 */

import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
// Plain holders: the config's mockReset clears vi.fn implementations per test
const state = vi.hoisted(() => ({
  filter: false,
  pages: {} as Record<number, string>,
  fetches: 0,
  requests: [] as string[],
  warnings: [] as string[],
  infos: [] as string[],
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ getAudibleLanguageFilter: async () => state.filter }),
}));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({
    getRegion: () => 'us',
    getBaseUrl: () => 'https://www.audible.com',
    fetch: async (_url: string, config: { params: { page: number } }) => (state.fetches++, { data: { data: state.pages[config.params.page] ?? '<html></html>' } }),
  }),
}));
vi.mock('@/lib/utils/logger', () => {
  const make = () => ({ debug() {}, info: (message: string) => state.infos.push(message), error() {}, warn: (message: string) => state.warnings.push(message) });
  return { RMABLogger: { create: make, forJob: make } };
});
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: object, handler: (r: object) => Promise<Response>) => handler(Object.assign(req, { user: { id: 'user-1' } })),
}));
vi.mock('@/lib/services/works.service', () => ({
  persistDedupGroups: async () => {},
  collapseByExistingWorks: async (books: unknown[]) => books,
  getSiblingAsins: async () => new Map(),
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ enrichAudiobooksWithMatches: async (books: unknown[]) => books, findPlexMatch: async () => null }));
vi.mock('@/lib/utils/ignored-audiobooks', () => ({ annotateWithIgnoreStatus: async (books: unknown[]) => books }));
vi.mock('@/lib/services/request-creator.service', () => ({
  createRequestForUser: async (_userId: string, book: { asin: string }) => {
    state.requests.push(book.asin);
    return { success: true };
  },
}));

// Imported after the mocks are set up (they read prismaMock)
const { scrapeSeriesPage } = await import('@/lib/integrations/audible-series');
const { processWatchedLists } = await import('@/lib/services/watched-lists.service');
const { GET } = await import('@/app/api/series/[asin]/route');

const SERIES = 'B0SERIES01';

/** A modern-layout row; its language comes from the row's JSON, as Audible sends it */
function row(asin: string, language: string | null, n: number): string {
  const meta = { authors: [{ name: 'Author', url: '/author/A/B0AUTHOR01' }], narrators: [{ name: `Narrator ${n}` }], duration: `${n} hrs`, ...(language && { language }) };
  return `<adbl-product-row><h3 slot="title"><a href="/pd/slug/${asin}">Book ${asin}</a></h3><script type="application/json">${JSON.stringify(meta)}</script></adbl-product-row>`;
}

function page(rows: Array<[string, string | null]>, headerCount?: number): string {
  return `<html><body><adbl-metadata-group size="xl"><adbl-metadata slot="title"><h1>Series</h1></adbl-metadata>${
    headerCount ? `<span slot="child"> ${headerCount} books in series </span>` : ''
  }</adbl-metadata-group><div id="series-titles">${rows.map(([asin, language], i) => row(asin, language, i + 1)).join('')}</div></body></html>`;
}

const rows = (prefix: string, count: number, language: string | null): Array<[string, string | null]> =>
  Array.from({ length: count }, (_, i) => [`${prefix}${String(i).padStart(10 - prefix.length, '0')}`, language]);

beforeEach(() => {
  state.filter = false;
  state.pages = {};
  state.fetches = 0;
  state.requests = [];
  state.warnings = [];
  state.infos = [];
  vi.useFakeTimers({ toFake: ['setTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scrapeSeriesPage', () => {
  it('off: every row and no new keys', async () => {
    state.pages[1] = page([...rows('B0EN', 2, 'English'), ...rows('B0ES', 1, 'Español')], 3);

    const detail = await scrapeSeriesPage(SERIES);

    expect(Object.keys(detail ?? {})).toEqual(['asin', 'title', 'bookCount', 'rating', 'ratingCount', 'description', 'tags', 'books', 'similarSeries', 'audibleUrl', 'hasMore', 'page']);
    expect(detail?.books).toHaveLength(3);
  });

  it.each([[undefined], [120]])('on, header count %s: counts and paging come from the rows as listed', async (headerCount) => {
    state.pages[1] = page([...rows('B0EN', 49, 'English'), ...rows('B0ES', 1, 'Español')], headerCount);
    const off = await scrapeSeriesPage(SERIES);
    state.filter = true;

    const detail = await scrapeSeriesPage(SERIES);

    expect(detail?.books.map((b) => b.asin)).not.toContain('B0ES000000');
    expect(detail?.books).toHaveLength(49);
    expect(detail).toMatchObject({ rawCount: 50, languageFilter: { language: 'en', hiddenCount: 1 } });
    expect({ bookCount: detail?.bookCount, hasMore: detail?.hasMore }).toEqual({ bookCount: off?.bookCount, hasMore: off?.hasMore });
    expect(detail?.bookCount).toBe(headerCount ?? 50);
  });

  it('on: keeps rows with no language (legacy rows list none)', async () => {
    state.filter = true;
    state.pages[1] = page([...rows('B0NO', 2, null), ...rows('B0FR', 1, 'Français')], 3);

    const detail = await scrapeSeriesPage(SERIES);

    expect(detail?.books.map((b) => b.asin)).toEqual(['B0NO000000', 'B0NO000001']);
  });

  it('on: a fully hidden page logs no layout-drift warning', async () => {
    state.filter = true;
    state.pages[1] = page(rows('B0DE', 3, 'Deutsch'), 3);

    const detail = await scrapeSeriesPage(SERIES);

    expect(detail?.books).toEqual([]);
    expect(state.warnings.filter((w) => w.includes('layout may have changed'))).toEqual([]);
  });
});

describe('GET /api/series/[asin]', () => {
  const get = async () => {
    const url = new URL(`http://localhost/api/series/${SERIES}?page=1`);
    const res = await GET({ nextUrl: url } as unknown as NextRequest, { params: Promise.resolve({ asin: SERIES }) });
    return res.json();
  };

  it('off: the response is as before (no hiddenCount, no rawCount)', async () => {
    state.pages[1] = page([...rows('B0EN', 1, 'English'), ...rows('B0ES', 1, 'Español')], 2);

    const body = await get();

    expect(Object.keys(body)).toEqual(['success', 'series', 'hasMore', 'page']);
    // (rating, ratingCount and description are undefined here, so JSON leaves them out)
    expect(Object.keys(body.series)).toEqual(['asin', 'title', 'bookCount', 'tags', 'books', 'similarSeries', 'audibleUrl', 'hasMore', 'page']);
    expect(body.series.books).toHaveLength(2);
  });

  it('on: hiddenCount and the language name, outside the series object', async () => {
    state.filter = true;
    state.pages[1] = page([...rows('B0EN', 1, 'English'), ...rows('B0ES', 1, 'Español')], 2);

    const body = await get();

    expect(body).toMatchObject({ hiddenCount: 1, filterLanguage: 'English' });
    expect(body.series.books.map((b: { asin: string }) => b.asin)).toEqual(['B0EN000000']);
    expect(body.series).not.toHaveProperty('rawCount');
    expect(body.series).not.toHaveProperty('languageFilter');
  });
});

describe('watched series scan', () => {
  beforeEach(() => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([
      { id: 'ws-1', userId: 'user-1', seriesAsin: SERIES, seriesTitle: 'Series', newReleasesSince: null, user: { id: 'user-1', plexUsername: 'u' } },
    ]);
    prismaMock.watchedSeries.update.mockResolvedValue({});
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
  });

  const scan = async () => {
    const run = processWatchedLists(undefined, { seriesAsin: SERIES });
    await vi.runAllTimersAsync();
    return run;
  };

  it('on: a fully hidden page 1 does not end the scan, and nothing on it is requested', async () => {
    state.filter = true;
    state.pages[1] = page(rows('B0ES', 50, 'Español'), 52);
    state.pages[2] = page(rows('B0EN', 2, 'English'), 52);

    await scan();

    expect(state.requests).toEqual(['B0EN000000', 'B0EN000001']);
  });

  it('on: the 200-book cap counts rows as listed, so a hidden series costs no more fetches than before', async () => {
    state.filter = true;
    for (let p = 1; p <= 5; p++) state.pages[p] = page(rows(`B0E${p}`, 50, 'Español'), 250);

    await scan();

    expect(state.fetches).toBe(4);
    expect(state.requests).toEqual([]);
  });

  it('on: a series whose books are all hidden is marked checked and logged as hidden, not "No books found"', async () => {
    state.filter = true;
    state.pages[1] = page(rows('B0ES', 3, 'Español'), 3);

    await scan();

    expect(state.requests).toEqual([]);
    expect(prismaMock.watchedSeries.update).toHaveBeenCalledWith({ where: { id: 'ws-1' }, data: { lastCheckedAt: expect.any(Date) } });
    expect(state.infos.some((m) => m.includes('All 3 books in series "Series" are in other languages'))).toBe(true);
    expect(state.infos.filter((m) => m.includes('No books found'))).toEqual([]);
  });

  it('off: every book on both pages is requested', async () => {
    state.pages[1] = page(rows('B0ES', 50, 'Español'), 52);
    state.pages[2] = page(rows('B0EN', 2, 'English'), 52);

    await scan();

    expect(state.requests).toHaveLength(52);
  });
});
