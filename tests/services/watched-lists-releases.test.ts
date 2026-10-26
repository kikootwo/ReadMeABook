/**
 * Component: Watched Lists Release Filter & Author Scan Tests
 * Documentation: documentation/features/watched-lists.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchByAuthorAsin = vi.hoisted(() => vi.fn());
const dedup = vi.hoisted(() => vi.fn());
const persistDedupGroups = vi.hoisted(() => vi.fn());

vi.mock('@/lib/integrations/audible.service', () => ({
  AUDIBLE_PAGE_SIZE: 50,
  getAudibleService: () => ({ searchByAuthorAsin }),
}));
vi.mock('@/lib/utils/deduplicate-audiobooks', () => ({ deduplicateAndCollectGroups: dedup }));
vi.mock('@/lib/services/works.service', () => ({ persistDedupGroups }));

import { booksForWatch, scanAuthorBooks, scanAuthorLegs } from '@/lib/services/watched-lists-releases';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';
import type { RMABLogger } from '@/lib/utils/logger';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const logger = log as unknown as RMABLogger;
const CUTOFF = new Date('2026-10-26T18:00:00Z'); // floor day 2026-10-25

const book = (asin: string, releaseDate?: string): AudibleAudiobook => ({ asin, title: asin, author: 'A', releaseDate });
const page = (books: AudibleAudiobook[], totalResults = 200, hasMore = true) => ({ books, hasMore, page: 1, totalResults });

async function run<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  dedup.mockImplementation((books: AudibleAudiobook[]) => ({ books, groups: [] }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('booksForWatch', () => {
  const books = [book('OLD', '2024-05-01'), book('EVE', '2026-10-25'), book('NEW', '2026-11-02'), book('NODATE')];

  it('passes every book, dated or not, for an entire-catalog watch', () => {
    const stats = { skippedBeforeCutoff: 0 };
    expect(booksForWatch(books, { newReleasesSince: null }, 'x', stats, logger)).toEqual(books);
    expect(booksForWatch(books, {}, 'x', stats, logger)).toEqual(books);
    expect(stats.skippedBeforeCutoff).toBe(0);
  });

  it('keeps only books released from the floor day on for a new-only watch', () => {
    const stats = { skippedBeforeCutoff: 0 };
    const kept = booksForWatch(books, { newReleasesSince: CUTOFF }, '"S" for u', stats, logger);
    expect(kept.map((b) => b.asin)).toEqual(['EVE', 'NEW']);
    expect(stats.skippedBeforeCutoff).toBe(2);
  });

  it('skips undated books and logs one count line for the watch', () => {
    const stats = { skippedBeforeCutoff: 0 };
    booksForWatch([book('U1'), book('U2'), book('U3', 'unknown')], { newReleasesSince: CUTOFF }, '"S" for u', stats, logger);
    expect(stats.skippedBeforeCutoff).toBe(3);
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(log.info.mock.calls[0][0]).toBe('New releases only for "S" for u: skipped 0 released before 2026-10-25, 3 undated');
  });
});

describe('scanAuthorBooks', () => {
  it('without a cutoff: relevance order, stops at a page with no matching books', async () => {
    searchByAuthorAsin
      .mockResolvedValueOnce(page([book('A', '2001-01-01')]))
      .mockResolvedValueOnce(page([]));

    const { books, complete } = await run(scanAuthorBooks('Name', 'AUTH', logger));

    expect(books.map((b) => b.asin)).toEqual(['A']);
    expect(complete).toBe(false);
    expect(searchByAuthorAsin.mock.calls).toEqual([['Name', 'AUTH', 1], ['Name', 'AUTH', 2]]);
  });

  it('without a cutoff: complete when Audible has no further pages within the cap', async () => {
    searchByAuthorAsin.mockResolvedValueOnce(page([book('A', '2001-01-01')], 1, false));
    const scan = await run(scanAuthorBooks('Name', 'AUTH', logger));
    expect(scan).toEqual({ books: [book('A', '2001-01-01')], complete: true });

    searchByAuthorAsin.mockReset().mockResolvedValue(page([book('B', '2001-01-01')], 1000, true));
    expect((await run(scanAuthorBooks('Name', 'AUTH', logger))).complete).toBe(false);
    expect(searchByAuthorAsin).toHaveBeenCalledTimes(4);
  });

  it('with a cutoff: newest first, stops after the page holding an older book', async () => {
    searchByAuthorAsin
      .mockResolvedValueOnce(page([book('N1', '2027-01-01'), book('N2', '2026-10-30')]))
      .mockResolvedValueOnce(page([book('N3', '2026-10-27'), book('OLD', '2025-03-01')]))
      .mockResolvedValueOnce(page([book('OLDER', '2020-01-01')]));

    const { books } = await run(scanAuthorBooks('Name', 'AUTH', logger, { since: CUTOFF }));

    expect(books.map((b) => b.asin)).toEqual(['N1', 'N2', 'N3', 'OLD']);
    expect(searchByAuthorAsin.mock.calls).toEqual([
      ['Name', 'AUTH', 1, { newestFirst: true }],
      ['Name', 'AUTH', 2, { newestFirst: true }],
    ]);
  });

  it('with a cutoff: a page with no matching books does not end the scan while Audible has more', async () => {
    searchByAuthorAsin
      .mockResolvedValueOnce(page([], 160, false)) // a page of namesakes / other languages
      .mockResolvedValueOnce(page([book('N1', '2026-12-01'), book('OLD', '2023-01-01')], 160, true));

    const { books } = await run(scanAuthorBooks('Name', 'AUTH', logger, { since: CUTOFF }));

    expect(books.map((b) => b.asin)).toEqual(['N1', 'OLD']);
    expect(searchByAuthorAsin).toHaveBeenCalledTimes(2);
  });

  it('with a cutoff: stops when Audible has no further pages, and never passes 4 pages', async () => {
    searchByAuthorAsin.mockResolvedValueOnce(page([book('N1', '2026-12-01')], 50, false));
    await run(scanAuthorBooks('Name', 'AUTH', logger, { since: CUTOFF }));
    expect(searchByAuthorAsin).toHaveBeenCalledTimes(1);

    searchByAuthorAsin.mockReset().mockResolvedValue(page([book('N', '2027-01-01')], 1000, true));
    await run(scanAuthorBooks('Name', 'AUTH', logger, { since: CUTOFF }));
    expect(searchByAuthorAsin).toHaveBeenCalledTimes(4);
  });
});

describe('scanAuthorLegs', () => {
  const entireWatch = { newReleasesSince: null };
  const newWatch = { newReleasesSince: CUTOFF };

  it('runs only the relevance scan when every watcher wants the entire catalog', async () => {
    searchByAuthorAsin.mockResolvedValueOnce(page([book('A', '2001-01-01')], 1, false));

    const scan = await run(scanAuthorLegs('Name', 'AUTH', [entireWatch, {}], logger));

    expect(searchByAuthorAsin.mock.calls).toEqual([['Name', 'AUTH', 1]]);
    expect(scan.found).toBe(1);
    expect(scan.booksFor(entireWatch).map((b) => b.asin)).toEqual(['A']);
  });

  it('runs only the newest-first scan, to the earliest cutoff, when every watcher is new-only', async () => {
    const later = { newReleasesSince: new Date('2026-12-01T00:00:00Z') };
    searchByAuthorAsin
      .mockResolvedValueOnce(page([book('N1', '2026-12-05'), book('N2', '2026-11-10')]))
      .mockResolvedValueOnce(page([book('OLD', '2025-01-01')]));

    const scan = await run(scanAuthorLegs('Name', 'AUTH', [later, newWatch], logger));

    // 2026-11-10 is past the later cutoff but not the earliest (2026-10-25), so page 2 is read
    expect(searchByAuthorAsin).toHaveBeenCalledTimes(2);
    expect(searchByAuthorAsin.mock.calls.every((c) => c[3]?.newestFirst === true)).toBe(true);
    expect(scan.booksFor(later).map((b) => b.asin)).toEqual(['N1', 'N2', 'OLD']);
  });

  it('runs both scans for a mixed group and feeds each watcher its own', async () => {
    // Relevance scan ends at a page with no matching books while Audible still has more
    searchByAuthorAsin.mockImplementation(async (_n: string, _a: string, p: number, opts?: { newestFirst?: boolean }) =>
      opts?.newestFirst
        ? page([book('NEW', '2026-11-20'), book('MID', '2024-01-01')], 200, true)
        : page(p === 1 ? [book('BACK1', '1999-01-01'), book('MID', '2024-01-01')] : [], 200, true));

    const scan = await run(scanAuthorLegs('Name', 'AUTH', [entireWatch, newWatch], logger));

    expect(searchByAuthorAsin.mock.calls.map((c) => c[3]?.newestFirst ?? false)).toEqual([false, false, true]);
    expect(scan.booksFor(entireWatch).map((b) => b.asin)).toEqual(['BACK1', 'MID']);
    expect(scan.booksFor(newWatch).map((b) => b.asin)).toEqual(['NEW', 'MID']);
    expect(scan.found).toBe(3);
    expect(dedup).toHaveBeenCalledTimes(2);
  });

  it('makes no newest-first call for a mixed group when the relevance scan read the whole catalog', async () => {
    searchByAuthorAsin.mockResolvedValueOnce(page([book('BACK1', '1999-01-01'), book('NEW', '2026-11-20')], 2, false));

    const scan = await run(scanAuthorLegs('Name', 'AUTH', [entireWatch, newWatch], logger));

    expect(searchByAuthorAsin.mock.calls).toEqual([['Name', 'AUTH', 1]]);
    expect(scan.found).toBe(2);
    expect(dedup).toHaveBeenCalledTimes(1);
    // New-only watchers get the whole list; booksForWatch applies each cutoff
    expect(scan.booksFor(newWatch).map((b) => b.asin)).toEqual(['BACK1', 'NEW']);
    const stats = { skippedBeforeCutoff: 0 };
    expect(booksForWatch(scan.booksFor(newWatch), newWatch, 'x', stats, logger).map((b) => b.asin)).toEqual(['NEW']);
  });

  it('persists the second scan dedup groups only after the first scan groups are written', async () => {
    searchByAuthorAsin.mockImplementation(async (_n: string, _a: string, p: number, opts?: { newestFirst?: boolean }) =>
      opts?.newestFirst ? page([book('OLD', '2024-01-01')], 200, true) : page(p === 1 ? [book('BACK1', '1999-01-01')] : [], 200, true));
    dedup.mockImplementation((books: AudibleAudiobook[]) => ({ books, groups: [{ asins: books.map((b) => b.asin) }] }));
    let finishFirst!: () => void;
    persistDedupGroups.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
    persistDedupGroups.mockImplementationOnce(async () => undefined);

    await run(scanAuthorLegs('Name', 'AUTH', [entireWatch, newWatch], logger));
    await vi.runAllTimersAsync();

    expect(persistDedupGroups).toHaveBeenCalledTimes(1);
    expect(persistDedupGroups.mock.calls[0][0]).toEqual([{ asins: ['BACK1'] }]);
    finishFirst();
    await vi.runAllTimersAsync();
    expect(persistDedupGroups).toHaveBeenCalledTimes(2);
    expect(persistDedupGroups.mock.calls[1][0]).toEqual([{ asins: ['OLD'] }]);
  });
});
