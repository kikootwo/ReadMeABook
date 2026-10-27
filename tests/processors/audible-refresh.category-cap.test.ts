/**
 * Component: Audible Refresh Category Cap Tests (#309)
 * Documentation: documentation/features/home-sections.md
 *
 * Each category section costs a cooldown and up to 4 pages per refresh, and sub-categories
 * raise the number users can pick, so one run refreshes at most 30 distinct categories,
 * stalest first: never stored, then stored longest ago, then the most users, then id.
 * Over the cap the selection rotates, so no category is skipped for good.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
// The shared model mock has no groupBy; the processor reads stored times through it.
const groupByMock = vi.fn();
Object.assign(prismaMock.audibleCacheCategory, { groupBy: groupByMock });

const audibleServiceMock = vi.hoisted(() => ({
  getPopularAudiobooks: vi.fn(),
  getNewReleases: vi.fn(),
  getCategoryBooks: vi.fn(),
}));
const thumbnailCacheMock = vi.hoisted(() => ({
  cacheThumbnail: vi.fn(),
  cleanupUnusedThumbnails: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));
vi.mock('@/lib/services/thumbnail-cache.service', () => ({
  getThumbnailCacheService: () => thumbnailCacheMock,
}));

const CAP = 30;
const pad = (n: number) => `cat-${String(n).padStart(2, '0')}`;
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => pad(from + i));

/** Saved category sections: one row per (user, category). */
function sectionRows(byCategory: Record<string, number>) {
  const rows: { categoryId: string; userId: string }[] = [];
  for (const [categoryId, users] of Object.entries(byCategory)) {
    for (let u = 0; u < users; u++) rows.push({ categoryId, userId: `user-${u}` });
  }
  return rows;
}

/** Answer findMany like Postgres would: `distinct` collapses repeated category ids. */
function serveSections(rows: { categoryId: string; userId: string }[]) {
  prismaMock.userHomeSection.findMany.mockImplementation(async (args: { distinct?: string[] } = {}) => {
    if (args.distinct?.includes('categoryId')) {
      return [...new Set(rows.map((r) => r.categoryId))].map((categoryId) => ({ categoryId }));
    }
    return rows.map((r) => ({ categoryId: r.categoryId, userId: r.userId }));
  });
}

/**
 * AudibleCacheCategory as a store of categoryId -> lastSyncedAt: deleteMany clears it,
 * create stamps it, groupBy answers `_max.lastSyncedAt` per stored category.
 */
function serveCategoryStore(seed: Record<string, Date> = {}) {
  const store = new Map<string, Date>(Object.entries(seed));
  prismaMock.audibleCacheCategory.deleteMany.mockImplementation(async ({ where }: { where: { categoryId: string } }) => {
    store.delete(where.categoryId);
    return { count: 0 };
  });
  prismaMock.audibleCacheCategory.create.mockImplementation(
    async ({ data }: { data: { categoryId: string; lastSyncedAt: Date } }) => {
      store.set(data.categoryId, data.lastSyncedAt);
      return {};
    },
  );
  groupByMock.mockImplementation(async ({ where }: { where: { categoryId: { in: string[] } } }) =>
    where.categoryId.in
      .filter((id) => store.has(id))
      .map((categoryId) => ({ categoryId, _max: { lastSyncedAt: store.get(categoryId) } })));
  return store;
}

let clock = Date.UTC(2026, 9, 1);

/** One scheduled run, each a day after the last; returns the categories it fetched. */
async function run(jobId: string): Promise<{ refreshed: string[]; result: Record<string, number> }> {
  clock += 24 * 60 * 60 * 1000;
  vi.setSystemTime(clock);
  audibleServiceMock.getCategoryBooks.mockClear();
  const { processAudibleRefresh } = await import('@/lib/processors/audible-refresh.processor');
  const result = await processAudibleRefresh({ jobId });
  return { refreshed: audibleServiceMock.getCategoryBooks.mock.calls.map((c) => c[0]), result };
}

describe('processAudibleRefresh category cap (#309)', () => {
  let origSetTimeout: typeof global.setTimeout;

  beforeEach(() => {
    origSetTimeout = global.setTimeout;
    global.setTimeout = ((fn: (...args: unknown[]) => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    vi.useFakeTimers({ toFake: ['Date'] });

    audibleServiceMock.getPopularAudiobooks.mockResolvedValue([]);
    audibleServiceMock.getNewReleases.mockResolvedValue([]);
    audibleServiceMock.getCategoryBooks.mockReset();
    audibleServiceMock.getCategoryBooks.mockResolvedValue([]);
    thumbnailCacheMock.cleanupUnusedThumbnails.mockResolvedValue(0);
    prismaMock.audibleCacheCategory.deleteMany.mockReset();
    prismaMock.audibleCacheCategory.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.audibleCacheCategory.create.mockReset();
    prismaMock.audibleCacheCategory.create.mockResolvedValue({});
    prismaMock.audibleCache.upsert.mockResolvedValue({});
    prismaMock.audibleCache.findMany.mockResolvedValue([]);
    groupByMock.mockReset();
    groupByMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    global.setTimeout = origSetTimeout;
  });

  it(`with nothing stored yet, refreshes at most ${CAP} categories, the most chosen first, and leaves the rest untouched`, async () => {
    const byCategory: Record<string, number> = {};
    for (let i = 1; i <= 35; i++) byCategory[pad(i)] = 1;
    byCategory[pad(35)] = 3;
    byCategory[pad(34)] = 3;
    byCategory[pad(20)] = 2;
    serveSections(sectionRows(byCategory));

    const { refreshed, result } = await run('job-cap');

    expect(refreshed).toHaveLength(CAP);
    expect(new Set(refreshed).size).toBe(CAP);
    const expected = [pad(34), pad(35), pad(20)];
    for (let i = 1; expected.length < CAP; i++) if (![20, 34, 35].includes(i)) expected.push(pad(i));
    expect(refreshed).toEqual(expected);

    const skipped = range(29, 33);
    expect(skipped.every((id) => !refreshed.includes(id))).toBe(true);
    const wiped = prismaMock.audibleCacheCategory.deleteMany.mock.calls.map((c) => c[0].where.categoryId);
    expect(skipped.some((id) => wiped.includes(id))).toBe(false);

    expect(result.categoriesSynced).toBe(CAP);
    expect(result.categoriesSkipped).toBe(5);
  });

  it('ranks never-stored first, then the oldest stored, then the most users, then id', async () => {
    const { selectCategoriesToRefresh } = await import('@/lib/processors/audible-refresh.processor');
    const day = (d: number) => new Date(Date.UTC(2026, 9, d));
    const chosen = ['old', 'popular', 'popular', 'popular', 'newer', 'never-b', 'never-a', 'never-a', 'same-z', 'same-y'];
    const stored = new Map([
      ['popular', day(9)], ['old', day(2)], ['newer', day(5)], ['same-z', day(7)], ['same-y', day(7)],
    ]);

    expect(selectCategoriesToRefresh(chosen, stored, 4)).toEqual({
      categoryIds: ['never-a', 'never-b', 'old', 'newer'],
      skipped: ['same-y', 'same-z', 'popular'],
    });
  });

  it('rotates over the cap: every one of 65 categories is refreshed within 3 runs, in every 3-run window', async () => {
    const all = range(1, 65);
    const byCategory = Object.fromEntries(all.map((id, i) => [id, i < 10 ? 5 : 1]));
    serveSections(sectionRows(byCategory));
    serveCategoryStore();
    audibleServiceMock.getCategoryBooks.mockImplementation(async (id: string) => [
      { asin: `B-${id}`, title: `Book of ${id}`, author: 'A' },
    ]);

    const runs: string[][] = [];
    for (let r = 0; r < 6; r++) {
      const { refreshed, result } = await run(`job-rot-${r}`);
      expect(refreshed).toHaveLength(CAP);
      expect(result.categoriesSkipped).toBe(65 - CAP);
      runs.push(refreshed);
    }

    const bound = Math.ceil(all.length / CAP);
    for (let start = 0; start + bound <= runs.length; start++) {
      const covered = new Set(runs.slice(start, start + bound).flat());
      expect(all.filter((id) => !covered.has(id))).toEqual([]);
    }
  });

  it('a newly added category is fetched on the next run, ahead of more-chosen stored ones', async () => {
    const byCategory = Object.fromEntries(range(1, 40).map((id) => [id, 4]));
    const seeded = Object.fromEntries(range(1, 40).map((id, i) => [id, new Date(Date.UTC(2026, 8, 1 + (i % 20)))]));
    serveCategoryStore(seeded);
    audibleServiceMock.getCategoryBooks.mockImplementation(async (id: string) => [
      { asin: `B-${id}`, title: `Book of ${id}`, author: 'A' },
    ]);

    // One user adds a late-sorting category nobody else chose; it has no stored data.
    serveSections(sectionRows({ ...byCategory, 'zz-new': 1 }));
    const { refreshed } = await run('job-new');

    expect(refreshed[0]).toBe('zz-new');
    expect(refreshed).toHaveLength(CAP);
  });

  it('refreshes every category, each once, when there are no more than the cap', async () => {
    serveSections(sectionRows({ 'node-b': 1, 'node-a': 2, 'node-c': 1 }));

    const { refreshed, result } = await run('job-under');

    expect([...refreshed].sort()).toEqual(['node-a', 'node-b', 'node-c']);
    expect(result.categoriesSynced).toBe(3);
    expect(result.categoriesSkipped ?? 0).toBe(0);
    expect(groupByMock).not.toHaveBeenCalled();
  });
});
