/**
 * Component: Library scan insert race regression tests (#222)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Two jobs that see the same new library item at the same time both read "no row" and
 * both insert it; the second insert hits the unique plex_guid. Both jobs must finish
 * without an error, leave one row, and keep the existing row's ASIN when the later item
 * has none. Mocked: prisma (in-memory plex_library whose first two lookups both run
 * before either insert, and whose insert raises the real P2002 on a duplicate
 * plex_guid), config, library service, thumbnail cache, job queue.
 */

import { Prisma } from '@/generated/prisma';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const libraryServiceMock = vi.hoisted(() => ({
  getLibraryItems: vi.fn(),
  getRecentlyAdded: vi.fn(),
  getCoverCachingParams: vi.fn(),
}));
const configMock = vi.hoisted(() => ({
  getBackendMode: vi.fn(),
  getPlexConfig: vi.fn(),
  getMany: vi.fn(),
  get: vi.fn(),
}));
const thumbnailCacheServiceMock = vi.hoisted(() => ({ cacheLibraryThumbnail: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: async () => libraryServiceMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/thumbnail-cache.service', () => ({ getThumbnailCacheService: () => thumbnailCacheServiceMock }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn() }));

const ASIN = 'B0RACE1234';
const ITEM = {
  id: 'rating-1',
  externalId: 'guid-race-1',
  title: 'Race Book',
  author: 'Some Author',
  addedAt: new Date('2026-10-01T00:00:00Z'),
};

/** In-memory plex_library, wired into the prisma mock in beforeEach (plain holder, not a factory impl). */
type Row = { id: string; plexGuid: string; plexLibraryId?: string; asin?: unknown; [field: string]: unknown };
type RowArgs = { where: { id?: string; plexGuid?: string }; data: Omit<Row, 'id'> };
type FindManyArgs = { where?: { plexLibraryId?: string; plexGuid?: { notIn: string[] } } } | undefined;
type Settled = PromiseSettledResult<{ newCount: number; updatedCount: number; skippedCount?: number }>;

const db = { rows: [] as Row[], inserts: [] as Array<{ asin: unknown; conflict: boolean }> };

/**
 * The first `parties` lookups each read the table, then wait until all of them have read
 * (or 2 s pass, so a run that fails early cannot hang the test).
 */
function lookupBarrier(parties: number) {
  const waiting: Array<() => void> = [];
  let remaining = parties;
  return async () => {
    if (remaining <= 0) return;
    remaining--;
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length === parties) waiting.forEach((release) => release());
      else setTimeout(resolve, 2000);
    });
  };
}

function wirePlexLibrary() {
  const gate = lookupBarrier(2);
  const byGuid = (guid: string) => db.rows.find((r) => r.plexGuid === guid) ?? null;
  const lookup = async (a: RowArgs) => {
    const found = byGuid(a.where.plexGuid ?? '');
    const snapshot = found ? { ...found } : null;
    await gate();
    return snapshot;
  };
  prismaMock.plexLibrary.findUnique.mockImplementation(lookup);
  prismaMock.plexLibrary.findFirst.mockImplementation(lookup);
  prismaMock.plexLibrary.create.mockImplementation(async (a: RowArgs) => {
    const conflict = byGuid(a.data.plexGuid) !== null;
    db.inserts.push({ asin: a.data.asin, conflict });
    if (conflict) {
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`plex_guid`)',
        { code: 'P2002', clientVersion: 'test', meta: { target: ['plex_guid'] } }
      );
    }
    const row: Row = { id: `row-${db.rows.length + 1}`, asin: null, ...a.data };
    db.rows.push(row);
    return row;
  });
  prismaMock.plexLibrary.update.mockImplementation(async (a: RowArgs) => {
    const row = a.where.id ? db.rows.find((r) => r.id === a.where.id) : byGuid(a.where.plexGuid ?? '');
    if (!row) throw new Error('update: no row');
    Object.assign(row, a.data);
    return row;
  });
  prismaMock.plexLibrary.findMany.mockImplementation(async (a: FindManyArgs) => {
    const w = a?.where;
    const notIn = w?.plexGuid?.notIn;
    if (notIn) {
      return db.rows.filter((r) => r.plexLibraryId === w?.plexLibraryId && !notIn.includes(r.plexGuid));
    }
    return db.rows;
  });
}

/**
 * Start `first`, let it run up to its gated lookup, then start `second`. The lookups still
 * overlap (barrier), but the processors' lazy `await import()` calls do not: Vitest hands
 * the real module, not the mock, to the second of two simultaneous dynamic imports.
 */
async function overlapping<T>(first: () => Promise<T>, second: () => Promise<T>) {
  const a = first();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return Promise.allSettled([a, second()]);
}

describe('library insert race (#222)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.rows = [];
    db.inserts = [];
    wirePlexLibrary();

    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.getMany.mockResolvedValue({
      plex_url: 'http://plex',
      plex_token: 'token',
      plex_audiobook_library_id: 'lib-1',
    });
    configMock.get.mockResolvedValue('lib-1');
    configMock.getPlexConfig.mockResolvedValue({
      serverUrl: 'http://plex',
      authToken: 'token',
      libraryId: 'lib-1',
      machineIdentifier: 'machine',
    });
    libraryServiceMock.getCoverCachingParams.mockResolvedValue({
      backendBaseUrl: 'http://plex',
      authToken: 'token',
      backendMode: 'plex',
    });
    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue(null);
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    prismaMock.audiobook.findMany.mockResolvedValue([]);
    prismaMock.request.findMany.mockResolvedValue([]);
  });

  it('recently added: two concurrent checks of the same new item end with one row and no error', async () => {
    libraryServiceMock.getRecentlyAdded.mockResolvedValue([{ ...ITEM, asin: ASIN }]);
    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');

    const results = await overlapping(
      () => processPlexRecentlyAddedCheck({ jobId: 'job-a' }),
      () => processPlexRecentlyAddedCheck({ jobId: 'job-b' })
    );

    expect(db.inserts.map((i) => i.conflict)).toEqual([false, true]); // the race really happened
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(db.rows).toHaveLength(1);
    const counts = results.map((r) => (r as Extract<Settled, { status: 'fulfilled' }>).value);
    expect(counts.map((c) => [c.newCount, c.updatedCount])).toEqual([[1, 0], [0, 1]]);
  });

  it('recently added: the row keeps its ASIN when the losing insert has none', async () => {
    libraryServiceMock.getRecentlyAdded
      .mockResolvedValueOnce([{ ...ITEM, asin: ASIN }])
      .mockResolvedValueOnce([{ ...ITEM, asin: undefined }]);
    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');

    const results = await overlapping(
      () => processPlexRecentlyAddedCheck({ jobId: 'job-a' }),
      () => processPlexRecentlyAddedCheck({ jobId: 'job-b' })
    );

    expect(db.inserts).toEqual([{ asin: ASIN, conflict: false }, { asin: undefined, conflict: true }]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].asin).toBe(ASIN);
  });

  it('full scan: two concurrent scans of the same new item leave one row, skip nothing, keep the ASIN', async () => {
    libraryServiceMock.getLibraryItems
      .mockResolvedValueOnce([{ ...ITEM, asin: ASIN }])
      .mockResolvedValueOnce([{ ...ITEM, asin: undefined }]);
    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');

    const results = await overlapping(
      () => processScanPlex({ jobId: 'job-a' }),
      () => processScanPlex({ jobId: 'job-b' })
    );

    expect(db.inserts).toEqual([{ asin: ASIN, conflict: false }, { asin: undefined, conflict: true }]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const scans = results.map((r) => (r as Extract<Settled, { status: 'fulfilled' }>).value);
    expect(scans.map((s) => [s.newCount, s.updatedCount, s.skippedCount])).toEqual([[1, 0, 0], [0, 1, 0]]);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].asin).toBe(ASIN);
  });
});
