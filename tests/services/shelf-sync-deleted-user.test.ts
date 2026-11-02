/**
 * Component: Shelf Sync Deleted-User Skip Tests
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * A Goodreads or Hardcover shelf whose user is soft-deleted (User.deletedAt set)
 * is skipped by every run: no feed or list fetch, no Audible lookup, no request,
 * no shelf write. An active user's shelf in the same run still syncs (#504).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const axiosGet = vi.hoisted(() => vi.fn());
const fetchHardcoverList = vi.hoisted(() => vi.fn());
const audibleSearch = vi.hoisted(() => vi.fn());
const createRequestForUser = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('axios', () => ({ default: { get: axiosGet } }));
vi.mock('@/lib/utils/logger', () => {
  const make = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  return { RMABLogger: { create: make, forJob: make } };
});
vi.mock('@/lib/services/hardcover-api.service', () => ({ fetchHardcoverList }));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ isEncryptedFormat: () => false, decrypt: (v: string) => v }),
}));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => ({ search: audibleSearch }) }));
vi.mock('@/lib/services/request-creator.service', () => ({ createRequestForUser }));

const DELETED_AT = new Date('2026-10-01T00:00:00Z');
const activeUser = { id: 'user-active', plexUsername: 'active', deletedAt: null };
const deletedUser = { id: 'user-deleted', plexUsername: 'deleted', deletedAt: DELETED_AT };
type TestUser = typeof activeUser | typeof deletedUser;

/** Goodreads feed 1 belongs to the active user, feed 2 to the deleted one; each holds one book. */
const goodreadsShelf = (id: string, feed: number, user: TestUser) => ({
  id, userId: user.id, name: `Shelf ${id}`, rssUrl: `https://www.goodreads.com/review/list_rss/${feed}`, autoRequest: true, user,
});
const hardcoverShelf = (id: string, token: string, user: TestUser) => ({
  id, userId: user.id, name: `List ${id}`, listId: `list-${id}`, apiToken: token, autoRequest: true, user,
});
const feedXml = (feed: number) =>
  `<?xml version="1.0"?><rss><channel><title>Shelf ${feed}</title><item><book_id>${feed}00</book_id>`
  + `<title>Book ${feed}</title><author_name>Author ${feed}</author_name></item></channel></rss>`;

function jobLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
const infoLines = (log: ReturnType<typeof jobLogger>) => log.info.mock.calls.map(([line]) => String(line));
const requestedUsers = () => createRequestForUser.mock.calls.map(([userId]) => userId);
const lookups = () => audibleSearch.mock.calls.map(([query]) => query);

async function goodreads(log: ReturnType<typeof jobLogger>, options = {}) {
  const { processGoodreadsShelves } = await import('@/lib/services/goodreads-sync.service');
  return processGoodreadsShelves(log as never, options);
}
async function hardcover(log: ReturnType<typeof jobLogger>, options = {}) {
  const { processHardcoverShelves } = await import('@/lib/services/hardcover-sync.service');
  return processHardcoverShelves(log as never, options);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.goodreadsShelf.findMany.mockResolvedValue([]);
  prismaMock.hardcoverShelf.findMany.mockResolvedValue([]);
  prismaMock.bookMapping.findUnique.mockResolvedValue(null);
  prismaMock.bookMapping.findMany.mockResolvedValue([]);
  prismaMock.audibleCache.findMany.mockResolvedValue([]);
  prismaMock.bookMapping.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'map', ...data }));
  axiosGet.mockImplementation(async (url: string) => ({
    status: 200, headers: {}, data: feedXml(Number(new URL(url).pathname.split('/').pop())),
  }));
  fetchHardcoverList.mockImplementation(async (token: string) => ({
    listName: `List of ${token}`, books: [{ bookId: `hc-${token}`, title: `Book of ${token}`, author: 'Author' }],
  }));
  audibleSearch.mockImplementation(async (query: string) => ({
    results: [{ asin: `ASIN-${query.length}`, title: query, author: 'Author' }],
  }));
  createRequestForUser.mockResolvedValue({ success: true, request: {} });
});

describe('Goodreads shelf sync with a deleted user', () => {
  it('skips the deleted user\'s shelf and still syncs the active user\'s', async () => {
    prismaMock.goodreadsShelf.findMany.mockResolvedValue([
      goodreadsShelf('gr-deleted', 2, deletedUser),
      goodreadsShelf('gr-active', 1, activeUser),
    ]);
    const log = jobLogger();

    const stats = await goodreads(log);

    expect(axiosGet.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/review/list_rss/1']);
    expect(lookups()).toEqual(['Book 1 Author 1']);
    expect(requestedUsers()).toEqual(['user-active']);
    expect(prismaMock.goodreadsShelf.update.mock.calls.map(([arg]) => arg.where.id)).toEqual(['gr-active']);
    expect(stats).toMatchObject({ shelvesProcessed: 1, lookupsPerformed: 1, requestsCreated: 1 });
    expect(infoLines(log)).toContain('Skipped 1 Goodreads shelf(s) whose user is deleted');
  });

  it('does nothing on a run scoped to the deleted user', async () => {
    prismaMock.goodreadsShelf.findMany.mockResolvedValue([goodreadsShelf('gr-deleted', 2, deletedUser)]);
    const log = jobLogger();

    const stats = await goodreads(log, { userId: 'user-deleted', maxLookupsPerShelf: 0 });

    expect(axiosGet).not.toHaveBeenCalled();
    expect(audibleSearch).not.toHaveBeenCalled();
    expect(createRequestForUser).not.toHaveBeenCalled();
    expect(prismaMock.bookMapping.create).not.toHaveBeenCalled();
    expect(prismaMock.goodreadsShelf.update).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ shelvesProcessed: 0, lookupsPerformed: 0, requestsCreated: 0 });
    expect(infoLines(log)).toContain('Skipped 1 Goodreads shelf(s) whose user is deleted');
  });
});

describe('Hardcover shelf sync with a deleted user', () => {
  it('skips the deleted user\'s list and still syncs the active user\'s', async () => {
    prismaMock.hardcoverShelf.findMany.mockResolvedValue([
      hardcoverShelf('hc-active', 'active-token', activeUser),
      hardcoverShelf('hc-deleted', 'deleted-token', deletedUser),
    ]);
    const log = jobLogger();

    const stats = await hardcover(log);

    expect(fetchHardcoverList.mock.calls.map(([token]) => token)).toEqual(['active-token']);
    expect(lookups()).toEqual(['Book of active-token Author']);
    expect(requestedUsers()).toEqual(['user-active']);
    expect(prismaMock.hardcoverShelf.update.mock.calls.map(([arg]) => arg.where.id)).toEqual(['hc-active']);
    expect(stats).toMatchObject({ shelvesProcessed: 1, lookupsPerformed: 1, requestsCreated: 1 });
    expect(infoLines(log)).toContain('Skipped 1 Hardcover list(s) whose user is deleted');
  });

  it('does nothing on a run scoped to the deleted user', async () => {
    prismaMock.hardcoverShelf.findMany.mockResolvedValue([hardcoverShelf('hc-deleted', 'deleted-token', deletedUser)]);
    const log = jobLogger();

    const stats = await hardcover(log, { userId: 'user-deleted', maxLookupsPerShelf: 0 });

    expect(fetchHardcoverList).not.toHaveBeenCalled();
    expect(audibleSearch).not.toHaveBeenCalled();
    expect(createRequestForUser).not.toHaveBeenCalled();
    expect(prismaMock.bookMapping.create).not.toHaveBeenCalled();
    expect(prismaMock.hardcoverShelf.update).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ shelvesProcessed: 0, lookupsPerformed: 0, requestsCreated: 0 });
    expect(infoLines(log)).toContain('Skipped 1 Hardcover list(s) whose user is deleted');
  });
});

describe('shelf sync with only active users', () => {
  it('logs no skip line and reads each shelf\'s user deletedAt from the database', async () => {
    prismaMock.goodreadsShelf.findMany.mockResolvedValue([goodreadsShelf('gr-active', 1, activeUser)]);
    prismaMock.hardcoverShelf.findMany.mockResolvedValue([hardcoverShelf('hc-active', 'active-token', activeUser)]);
    const log = jobLogger();

    await goodreads(log);
    await hardcover(log);

    expect(requestedUsers()).toEqual(['user-active', 'user-active']);
    expect(infoLines(log).filter((line) => line.includes('whose user is deleted'))).toEqual([]);
    for (const findMany of [prismaMock.goodreadsShelf.findMany, prismaMock.hardcoverShelf.findMany]) {
      expect(findMany.mock.calls[0][0].include.user.select).toMatchObject({ deletedAt: true });
    }
  });
});
