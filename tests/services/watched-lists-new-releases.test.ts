/**
 * Component: Watched Lists "New releases only" Tests (service level)
 * Documentation: documentation/features/watched-lists.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const scrapeSeriesPage = vi.hoisted(() => vi.fn());
const searchByAuthorAsin = vi.hoisted(() => vi.fn());
const dedup = vi.hoisted(() => vi.fn());
const createRequestForUser = vi.hoisted(() => vi.fn());
const warnings = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => {
  const log = () => ({ debug: vi.fn(), info: vi.fn(), warn: (m: string) => { warnings.push(m); }, error: vi.fn() });
  return { RMABLogger: { create: log, forJob: log } };
});
vi.mock('@/lib/integrations/audible-series', () => ({ scrapeSeriesPage }));
vi.mock('@/lib/integrations/audible.service', () => ({ AUDIBLE_PAGE_SIZE: 50, getAudibleService: () => ({ searchByAuthorAsin }) }));
vi.mock('@/lib/utils/deduplicate-audiobooks', () => ({ deduplicateAndCollectGroups: dedup }));
vi.mock('@/lib/services/works.service', () => ({
  persistDedupGroups: async () => undefined,
  getSiblingAsins: async () => new Map(),
}));
vi.mock('@/lib/services/request-creator.service', () => ({ createRequestForUser }));

const CUTOFF = new Date('2026-10-26T18:00:00Z'); // requests books dated 2026-10-25 or later
const user = (id: string) => ({ id, plexUsername: id });
type Book = { asin: string; title: string; author: string; releaseDate?: string };
const book = (asin: string, releaseDate?: string): Book => ({ asin, title: `Title ${asin}`, author: 'Author', releaseDate });
const SERIES_BOOKS = [book('B0OLD00001', '2021-01-28'), book('B0EVE00001', '2026-10-25'), book('B0NEW00001', '2026-11-03'), book('B0NODATE01')];

const seriesWatch = (id: string, userId: string, newReleasesSince: Date | null | undefined) => ({
  id, userId, seriesAsin: 'B0SERIES01', seriesTitle: 'Series', newReleasesSince, user: user(userId),
});
const authorWatch = (id: string, userId: string, newReleasesSince: Date | null | undefined) => ({
  id, userId, authorAsin: 'B0AUTHOR01', authorName: 'Author', newReleasesSince, user: user(userId),
});
const authorPage = (books: Book[], totalResults: number, hasMore: boolean) => ({ books, hasMore, page: 1, totalResults });

/** ASINs requested per user, in order */
function requested(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [userId, b, opts] of createRequestForUser.mock.calls) {
    expect(opts).toEqual({ automatic: true });
    (out[userId] ||= []).push(b.asin);
  }
  return out;
}

async function run(options = {}) {
  const { processWatchedLists } = await import('@/lib/services/watched-lists.service');
  const promise = processWatchedLists(undefined, options);
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.clearAllMocks();
  warnings.length = 0;
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  prismaMock.watchedSeries.findMany.mockResolvedValue([]);
  prismaMock.watchedAuthor.findMany.mockResolvedValue([]);
  prismaMock.watchedSeries.update.mockResolvedValue({});
  prismaMock.watchedAuthor.update.mockResolvedValue({});
  prismaMock.plexLibrary.findMany.mockResolvedValue([]);
  dedup.mockImplementation((books: Book[]) => ({ books, groups: [] }));
  createRequestForUser.mockResolvedValue({ success: true, request: {} });
  scrapeSeriesPage.mockResolvedValue({ asin: 'B0SERIES01', title: 'Series', bookCount: 4, books: SERIES_BOOKS, hasMore: false, page: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('watched series, new releases only', () => {
  it('requests only books released on or after the cutoff day (one day of grace)', async () => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([seriesWatch('ws-1', 'u1', CUTOFF)]);

    const stats = await run();

    expect(requested()).toEqual({ u1: ['B0EVE00001', 'B0NEW00001'] });
    expect(stats.requestsCreated).toBe(2);
  });

  it('skips undated books and counts them with the older ones', async () => {
    scrapeSeriesPage.mockResolvedValue({ asin: 'B0SERIES01', title: 'Series', bookCount: 2, books: [book('B0NODATE01'), book('B0NODATE02')], hasMore: false, page: 1 });
    prismaMock.watchedSeries.findMany.mockResolvedValue([seriesWatch('ws-1', 'u1', CUTOFF)]);

    const stats = await run();

    expect(createRequestForUser).not.toHaveBeenCalled();
    expect(stats.skippedBeforeCutoff).toBe(2);
  });

  it('leaves an existing watch on the entire catalog: old and undated books are requested', async () => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([seriesWatch('ws-1', 'u1', undefined), seriesWatch('ws-2', 'u2', null)]);

    const stats = await run();

    const all = SERIES_BOOKS.map((b) => b.asin);
    expect(requested()).toEqual({ u1: all, u2: all });
    expect(stats.skippedBeforeCutoff).toBe(0);
  });

  it('scrapes a series once and filters per watcher when modes differ', async () => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([seriesWatch('ws-1', 'entire', null), seriesWatch('ws-2', 'fresh', CUTOFF)]);

    await run();

    expect(scrapeSeriesPage).toHaveBeenCalledTimes(1);
    expect(requested()).toEqual({ entire: SERIES_BOOKS.map((b) => b.asin), fresh: ['B0EVE00001', 'B0NEW00001'] });
  });
});

describe('watched series over the 200-book scan limit', () => {
  const fifty = (p: number) => Array.from({ length: 50 }, (_, i) => book(`B0P${p}${String(i).padStart(6, '0')}`, '2001-01-01'));
  const longSeries = async (_asin: string, p: number) => ({ asin: 'B0SERIES01', title: 'Series', bookCount: 260, books: fifty(p), hasMore: true, page: p });
  const capWarnings = () => warnings.filter((w) => w.includes('more than 200 books'));

  it('logs one warning when the series has a new-only watcher', async () => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([seriesWatch('ws-1', 'u1', null), seriesWatch('ws-2', 'u2', CUTOFF)]);
    scrapeSeriesPage.mockImplementation(longSeries);
    await run();
    expect(scrapeSeriesPage).toHaveBeenCalledTimes(4);
    expect(capWarnings()).toHaveLength(1);
  });

  it('does not warn for entire-catalog watchers only, or for a new-only series under the limit', async () => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([seriesWatch('ws-1', 'u1', null)]);
    scrapeSeriesPage.mockImplementation(longSeries);
    await run();
    prismaMock.watchedSeries.findMany.mockResolvedValue([seriesWatch('ws-2', 'u2', CUTOFF)]);
    scrapeSeriesPage.mockResolvedValue({ asin: 'B0SERIES01', title: 'Series', bookCount: 4, books: SERIES_BOOKS, hasMore: false, page: 1 });
    await run();
    expect(capWarnings()).toHaveLength(0);
  });
});

describe('watched authors, new releases only', () => {
  it('scans an entire-catalog-only author exactly as before: relevance order, page 2 read despite an old book', async () => {
    prismaMock.watchedAuthor.findMany.mockResolvedValue([authorWatch('wa-1', 'u1', null)]);
    searchByAuthorAsin
      .mockResolvedValueOnce(authorPage([book('B0OLD00001', '2003-01-01')], 60, true))
      .mockResolvedValueOnce(authorPage([book('B0OLD00002', '2002-01-01')], 60, false));

    await run();

    expect(searchByAuthorAsin.mock.calls).toEqual([['Author', 'B0AUTHOR01', 1], ['Author', 'B0AUTHOR01', 2]]);
    expect(requested()).toEqual({ u1: ['B0OLD00001', 'B0OLD00002'] });
  });

  it('scans newest first for a new-only author and stops after the page holding an older book', async () => {
    prismaMock.watchedAuthor.findMany.mockResolvedValue([authorWatch('wa-1', 'u1', CUTOFF)]);
    searchByAuthorAsin
      .mockResolvedValueOnce(authorPage([book('B0NEW00001', '2027-02-01'), book('B0OLD00001', '2025-06-01')], 200, true))
      .mockResolvedValueOnce(authorPage([book('B0OLD00002', '2024-01-01')], 200, true));

    await run();

    expect(searchByAuthorAsin.mock.calls).toEqual([['Author', 'B0AUTHOR01', 1, { newestFirst: true }]]);
    expect(requested()).toEqual({ u1: ['B0NEW00001'] });
  });

  it('gives a mixed author group both scans and feeds each watcher from its own', async () => {
    prismaMock.watchedAuthor.findMany.mockResolvedValue([authorWatch('wa-1', 'entire', null), authorWatch('wa-2', 'fresh', CUTOFF)]);
    searchByAuthorAsin.mockImplementation(async (_n: string, _a: string, p: number, opts?: { newestFirst?: boolean }) =>
      opts?.newestFirst
        ? authorPage([book('B0NEW00001', '2026-12-01'), book('B0OLD00009', '2019-01-01')], 300, true)
        : authorPage(p === 1 ? [book('B0BACK0001', '1998-01-01'), book('B0BACK0002', '2001-01-01')] : [], 300, true));

    const stats = await run();

    expect(searchByAuthorAsin.mock.calls.map((c) => c[3]?.newestFirst ?? false)).toEqual([false, false, true]);
    expect(requested()).toEqual({ entire: ['B0BACK0001', 'B0BACK0002'], fresh: ['B0NEW00001'] });
    expect(stats.booksFound).toBe(4);
  });

  it('checks only the new author when a watch on it was just added, not the user\'s watched series (#429)', async () => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([seriesWatch('ws-1', 'u1', null)]);
    prismaMock.watchedAuthor.findMany.mockResolvedValue([authorWatch('wa-1', 'u1', null)]);
    searchByAuthorAsin.mockResolvedValue(authorPage([book('B0AUTH0001', '2010-01-01')], 1, false));

    const stats = await run({ userId: 'u1', authorAsin: 'B0AUTHOR01' });

    expect(prismaMock.watchedSeries.findMany).not.toHaveBeenCalled();
    expect(scrapeSeriesPage).not.toHaveBeenCalled();
    expect(prismaMock.watchedAuthor.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', authorAsin: 'B0AUTHOR01' } }));
    expect(stats).toMatchObject({ authorsChecked: 1, seriesChecked: 0 });
  });
});
