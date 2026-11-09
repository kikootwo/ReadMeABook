/**
 * Component: Watched Lists Deleted-User Skip Tests
 * Documentation: documentation/features/watched-lists.md
 *
 * A watch whose user is soft-deleted (User.deletedAt set) is skipped by every
 * run: no Audible scrape for it, no request, no lastCheckedAt write. An active
 * user's watch of the same series or author still runs as before (#504).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const scrapeSeriesPage = vi.hoisted(() => vi.fn());
const searchByAuthorAsin = vi.hoisted(() => vi.fn());
const createRequestForUser = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => {
  const make = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  return { RMABLogger: { create: make, forJob: make } };
});
vi.mock('@/lib/integrations/audible-series', () => ({ scrapeSeriesPage }));
vi.mock('@/lib/integrations/audible.service', () => ({
  AUDIBLE_PAGE_SIZE: 50,
  getAudibleService: () => ({ searchByAuthorAsin }),
}));
vi.mock('@/lib/utils/deduplicate-audiobooks', () => ({
  deduplicateAndCollectGroups: (books: unknown[]) => ({ books, groups: [] }),
}));
vi.mock('@/lib/services/works.service', () => ({
  persistDedupGroups: vi.fn(),
  getSiblingAsins: vi.fn(async () => new Map()),
}));
vi.mock('@/lib/services/request-creator.service', () => ({ createRequestForUser }));
vi.mock('@/lib/services/watched-lists-releases', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/watched-lists-releases')>()),
  delay: () => Promise.resolve(),
}));

const DELETED_AT = new Date('2026-10-01T00:00:00Z');
const activeUser = { id: 'user-active', plexUsername: 'active', deletedAt: null };
const deletedUser = { id: 'user-deleted', plexUsername: 'deleted', deletedAt: DELETED_AT };

const series = (id: string, seriesAsin: string, user: typeof activeUser | typeof deletedUser) => ({
  id, userId: user.id, seriesAsin, seriesTitle: `Series ${seriesAsin}`, newReleasesSince: null, user,
});
const author = (id: string, authorAsin: string, user: typeof activeUser | typeof deletedUser) => ({
  id, userId: user.id, authorAsin, authorName: `Author ${authorAsin}`, newReleasesSince: null, user,
});
const book = (asin: string) => ({ asin, title: `Book ${asin}`, author: 'Someone' });

function jobLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function run(log: ReturnType<typeof jobLogger>, options = {}) {
  const { processWatchedLists } = await import('@/lib/services/watched-lists.service');
  return processWatchedLists(log as never, options);
}

const infoLines = (log: ReturnType<typeof jobLogger>) => log.info.mock.calls.map(([line]) => String(line));
const requestedUsers = () => createRequestForUser.mock.calls.map(([userId]) => userId);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.watchedSeries.findMany.mockResolvedValue([]);
  prismaMock.watchedAuthor.findMany.mockResolvedValue([]);
  prismaMock.plexLibrary.findMany.mockResolvedValue([]);
  createRequestForUser.mockResolvedValue({ success: true, request: {} });
  scrapeSeriesPage.mockImplementation(async (asin: string) => ({ books: [book(`${asin}-B1`)], hasMore: false }));
  searchByAuthorAsin.mockImplementation(async (_name: string, asin: string) => ({
    books: [book(`${asin}-B1`)], hasMore: false, totalResults: 1,
  }));
});

describe('processWatchedLists with a deleted user', () => {
  it('skips the deleted user\'s series watches and still runs the active user\'s', async () => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([
      series('ws-active', 'SHARED', activeUser),
      series('ws-deleted-shared', 'SHARED', deletedUser),
      series('ws-deleted-only', 'DELETED-ONLY', deletedUser),
    ]);
    const log = jobLogger();

    const stats = await run(log);

    expect(scrapeSeriesPage.mock.calls.map(([asin]) => asin)).toEqual(['SHARED']);
    expect(requestedUsers()).toEqual(['user-active']);
    expect(prismaMock.watchedSeries.update.mock.calls.map(([arg]) => arg.where.id)).toEqual(['ws-active']);
    expect(stats).toMatchObject({ seriesChecked: 1, requestsCreated: 1 });
    expect(infoLines(log)).toContain('Skipped 2 watched series whose user is deleted');
  });

  it('skips the deleted user\'s author watches and still runs the active user\'s', async () => {
    prismaMock.watchedAuthor.findMany.mockResolvedValue([
      author('wa-deleted-shared', 'SHARED', deletedUser),
      author('wa-active', 'SHARED', activeUser),
      author('wa-deleted-only', 'DELETED-ONLY', deletedUser),
    ]);
    const log = jobLogger();

    const stats = await run(log);

    expect(searchByAuthorAsin.mock.calls.map(([, asin]) => asin)).toEqual(['SHARED']);
    expect(requestedUsers()).toEqual(['user-active']);
    expect(prismaMock.watchedAuthor.update.mock.calls.map(([arg]) => arg.where.id)).toEqual(['wa-active']);
    expect(stats).toMatchObject({ authorsChecked: 1, requestsCreated: 1 });
    expect(infoLines(log)).toContain('Skipped 2 watched authors whose user is deleted');
  });

  it('does nothing on a run scoped to the deleted user', async () => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([series('ws-deleted', 'S1', deletedUser)]);
    prismaMock.watchedAuthor.findMany.mockResolvedValue([author('wa-deleted', 'A1', deletedUser)]);
    const log = jobLogger();

    const stats = await run(log, { userId: 'user-deleted' });

    expect(scrapeSeriesPage).not.toHaveBeenCalled();
    expect(searchByAuthorAsin).not.toHaveBeenCalled();
    expect(createRequestForUser).not.toHaveBeenCalled();
    expect(prismaMock.watchedSeries.update).not.toHaveBeenCalled();
    expect(prismaMock.watchedAuthor.update).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ seriesChecked: 0, authorsChecked: 0, requestsCreated: 0 });
    expect(infoLines(log)).toEqual(expect.arrayContaining([
      'Skipped 1 watched series whose user is deleted',
      'Skipped 1 watched authors whose user is deleted',
    ]));
  });

  it('logs no skip line when no watch belongs to a deleted user', async () => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([series('ws-active', 'S1', activeUser)]);
    const log = jobLogger();

    await run(log);

    expect(requestedUsers()).toEqual(['user-active']);
    expect(infoLines(log).filter((line) => line.includes('whose user is deleted'))).toEqual([]);
  });

  it('reads each watch\'s user deletedAt from the database', async () => {
    await run(jobLogger());

    for (const findMany of [prismaMock.watchedSeries.findMany, prismaMock.watchedAuthor.findMany]) {
      expect(findMany.mock.calls[0][0].include.user.select).toMatchObject({ deletedAt: true });
    }
  });
});
