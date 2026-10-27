/**
 * Component: Audible Refresh Processor Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const audibleServiceMock = vi.hoisted(() => ({
  getPopularAudiobooks: vi.fn(),
  getNewReleases: vi.fn(),
  getCategoryBooks: vi.fn(),
}));
const thumbnailCacheMock = vi.hoisted(() => ({
  cacheThumbnail: vi.fn(),
  cleanupUnusedThumbnails: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

vi.mock('@/lib/services/thumbnail-cache.service', () => ({
  getThumbnailCacheService: () => thumbnailCacheMock,
}));

describe('processAudibleRefresh', () => {
  let origSetTimeout: typeof global.setTimeout;

  beforeEach(() => {
    vi.clearAllMocks();
    origSetTimeout = global.setTimeout;
    // Replace setTimeout so the batch cooldown resolves instantly
    global.setTimeout = ((fn: (...args: any[]) => void) => {
      fn();
      return 0 as ReturnType<typeof setTimeout>;
    }) as any;
  });

  afterEach(() => {
    global.setTimeout = origSetTimeout;
  });

  it('refreshes popular and new releases via AudibleCacheCategory', async () => {
    const popular = [
      {
        asin: 'ASIN-1',
        title: 'Popular One',
        author: 'Author A',
        narrator: 'Narrator A',
        description: 'Desc',
        coverArtUrl: 'http://image/1',
        durationMinutes: 120,
        releaseDate: '2024-01-01',
        rating: 4.8,
        genres: ['fiction'],
      },
      {
        asin: 'ASIN-2',
        title: 'Popular Two',
        author: 'Author B',
        narrator: 'Narrator B',
        description: 'Desc',
        coverArtUrl: null,
        durationMinutes: 90,
        releaseDate: null,
        rating: null,
        genres: [],
      },
    ];
    const newReleases = [
      {
        asin: 'ASIN-3',
        title: 'New Release',
        author: 'Author C',
        narrator: 'Narrator C',
        description: 'Desc',
        coverArtUrl: 'http://image/3',
        durationMinutes: 200,
        releaseDate: '2024-02-02',
        rating: 4.2,
        genres: ['history'],
      },
    ];

    audibleServiceMock.getPopularAudiobooks.mockResolvedValue(popular);
    audibleServiceMock.getNewReleases.mockResolvedValue(newReleases);
    thumbnailCacheMock.cacheThumbnail.mockResolvedValue('cached/path.jpg');
    thumbnailCacheMock.cleanupUnusedThumbnails.mockResolvedValue(2);
    prismaMock.audibleCache.upsert.mockResolvedValue({});
    prismaMock.audibleCacheCategory.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.audibleCacheCategory.create.mockResolvedValue({});
    // No user-configured categories
    prismaMock.userHomeSection.findMany.mockResolvedValue([]);

    prismaMock.audibleCache.findMany.mockResolvedValue([
      { asin: 'ASIN-1' },
      { asin: 'ASIN-2' },
      { asin: 'ASIN-3' },
    ]);

    const { processAudibleRefresh } = await import('@/lib/processors/audible-refresh.processor');
    const result = await processAudibleRefresh({ jobId: 'job-1' });

    expect(result.success).toBe(true);
    expect(result.popularSaved).toBe(2);
    expect(result.newReleasesSaved).toBe(1);
    expect(result.categoriesSynced).toBe(0);

    // Should wipe old entries for __popular__ and __new_releases__
    expect(prismaMock.audibleCacheCategory.deleteMany).toHaveBeenCalledWith({
      where: { categoryId: '__popular__' },
    });
    expect(prismaMock.audibleCacheCategory.deleteMany).toHaveBeenCalledWith({
      where: { categoryId: '__new_releases__' },
    });

    // 3 metadata upserts (2 popular + 1 new release)
    expect(prismaMock.audibleCache.upsert).toHaveBeenCalledTimes(3);

    // 3 category entries created (2 popular + 1 new release)
    expect(prismaMock.audibleCacheCategory.create).toHaveBeenCalledTimes(3);
    expect(prismaMock.audibleCacheCategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ asin: 'ASIN-1', categoryId: '__popular__', rank: 1 }),
    });
    expect(prismaMock.audibleCacheCategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ asin: 'ASIN-2', categoryId: '__popular__', rank: 2 }),
    });
    expect(prismaMock.audibleCacheCategory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ asin: 'ASIN-3', categoryId: '__new_releases__', rank: 1 }),
    });

    // Thumbnail caching still works
    expect(thumbnailCacheMock.cacheThumbnail).toHaveBeenCalledWith('ASIN-1', 'http://image/1');
    expect(thumbnailCacheMock.cacheThumbnail).toHaveBeenCalledWith('ASIN-3', 'http://image/3');
    expect(thumbnailCacheMock.cleanupUnusedThumbnails).toHaveBeenCalled();

    const activeSet = thumbnailCacheMock.cleanupUnusedThumbnails.mock.calls[0][0] as Set<string>;
    expect(Array.from(activeSet).sort()).toEqual(['ASIN-1', 'ASIN-2', 'ASIN-3']);
  });

  it('scrapes user-configured categories after popular/new-releases', async () => {
    audibleServiceMock.getPopularAudiobooks.mockResolvedValue([]);
    audibleServiceMock.getNewReleases.mockResolvedValue([]);
    thumbnailCacheMock.cacheThumbnail.mockResolvedValue('cached/cat.jpg');
    thumbnailCacheMock.cleanupUnusedThumbnails.mockResolvedValue(0);
    prismaMock.audibleCacheCategory.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.audibleCacheCategory.create.mockResolvedValue({});

    // User has one category section
    prismaMock.userHomeSection.findMany.mockResolvedValue([
      { categoryId: 'node-42' },
    ]);

    // getCategoryBooks returns 2 books
    audibleServiceMock.getCategoryBooks.mockResolvedValue([
      { asin: 'CAT-1', title: 'Cat Book 1', author: 'Author', coverArtUrl: 'http://img/c1' },
      { asin: 'CAT-2', title: 'Cat Book 2', author: 'Author', coverArtUrl: null },
    ]);

    prismaMock.audibleCache.upsert.mockResolvedValue({});
    prismaMock.audibleCache.findMany.mockResolvedValue([]);

    const { processAudibleRefresh } = await import('@/lib/processors/audible-refresh.processor');
    const result = await processAudibleRefresh({ jobId: 'job-cat' });

    expect(result.categoriesSynced).toBe(1);
    expect(audibleServiceMock.getCategoryBooks).toHaveBeenCalledWith('node-42', 200);

    // Should wipe entries for node-42 only; the empty popular/new-releases lists keep theirs
    expect(prismaMock.audibleCacheCategory.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.audibleCacheCategory.deleteMany).toHaveBeenCalledWith({
      where: { categoryId: 'node-42' },
    });

    // 2 category book creates (for node-42) — popular/new-releases had 0 books
    expect(prismaMock.audibleCacheCategory.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.audibleCache.upsert).toHaveBeenCalledTimes(2);
  });

  it('rethrows fatal errors', async () => {
    // Mock audible service to return data so we reach the DB calls
    audibleServiceMock.getPopularAudiobooks.mockResolvedValue([
      { asin: 'ASIN-1', title: 'Popular One', author: 'Author A' },
    ]);
    audibleServiceMock.getNewReleases.mockResolvedValue([]);
    // First DB call is audibleCacheCategory.deleteMany (for __popular__)
    prismaMock.audibleCacheCategory.deleteMany.mockRejectedValue(new Error('DB down'));

    const { processAudibleRefresh } = await import('@/lib/processors/audible-refresh.processor');
    await expect(processAudibleRefresh({ jobId: 'job-2' })).rejects.toThrow('DB down');
  });

  it('keeps the previous entries when a fetch returns no books (regression: one failed night blanked the section)', async () => {
    audibleServiceMock.getPopularAudiobooks.mockResolvedValue([]);
    audibleServiceMock.getNewReleases.mockResolvedValue([]);
    audibleServiceMock.getCategoryBooks.mockImplementation(async (catId: string) =>
      catId === 'node-ok'
        ? [{ asin: 'CAT-OK', title: 'Cat Book', author: 'Author', coverArtUrl: null }]
        : [],
    );
    thumbnailCacheMock.cleanupUnusedThumbnails.mockResolvedValue(0);
    prismaMock.audibleCacheCategory.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.audibleCacheCategory.create.mockResolvedValue({});
    prismaMock.audibleCache.upsert.mockResolvedValue({});
    prismaMock.userHomeSection.findMany.mockResolvedValue([
      { categoryId: 'node-failed' },
      { categoryId: 'node-ok' },
    ]);
    prismaMock.audibleCache.findMany.mockResolvedValue([]);

    const { processAudibleRefresh } = await import('@/lib/processors/audible-refresh.processor');
    const result = await processAudibleRefresh({ jobId: 'job-empty' });

    expect(result.success).toBe(true);
    expect(result.popularSaved).toBe(0);
    expect(result.newReleasesSaved).toBe(0);
    // Only the category that returned books is replaced and counted as synced
    expect(result.categoriesSynced).toBe(1);
    expect(prismaMock.audibleCacheCategory.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.audibleCacheCategory.deleteMany).toHaveBeenCalledWith({
      where: { categoryId: 'node-ok' },
    });
    expect(prismaMock.audibleCacheCategory.create).toHaveBeenCalledTimes(1);
  });

  it('deduplicates ASINs in the input list before persisting, preserving order', async () => {
    // Two `A` entries should collapse to one. Final ranks must be contiguous
    // (1, 2, 3) and follow Audible's editorial ordering (A, B, C).
    const popular = [
      { asin: 'A', title: 'Book A', author: 'X', coverArtUrl: null },
      { asin: 'B', title: 'Book B', author: 'X', coverArtUrl: null },
      { asin: 'A', title: 'Book A (duplicate)', author: 'X', coverArtUrl: null },
      { asin: 'C', title: 'Book C', author: 'X', coverArtUrl: null },
    ];

    audibleServiceMock.getPopularAudiobooks.mockResolvedValue(popular);
    audibleServiceMock.getNewReleases.mockResolvedValue([]);
    thumbnailCacheMock.cleanupUnusedThumbnails.mockResolvedValue(0);
    prismaMock.audibleCache.upsert.mockResolvedValue({});
    prismaMock.audibleCacheCategory.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.audibleCacheCategory.create.mockResolvedValue({});
    prismaMock.userHomeSection.findMany.mockResolvedValue([]);
    prismaMock.audibleCache.findMany.mockResolvedValue([]);

    const { processAudibleRefresh } = await import('@/lib/processors/audible-refresh.processor');
    const result = await processAudibleRefresh({ jobId: 'job-dedup' });

    expect(result.popularSaved).toBe(3);

    // Only 3 category entries created — the duplicate `A` was dropped.
    const popularCreates = (prismaMock.audibleCacheCategory.create.mock.calls as Array<[{ data: { asin: string; categoryId: string; rank: number } }]>)
      .map((c) => c[0].data)
      .filter((d) => d.categoryId === '__popular__');
    expect(popularCreates).toHaveLength(3);
    expect(popularCreates.map((d) => d.asin)).toEqual(['A', 'B', 'C']);
    expect(popularCreates.map((d) => d.rank)).toEqual([1, 2, 3]);

    // upsert called once per unique ASIN, not per input row.
    expect(prismaMock.audibleCache.upsert).toHaveBeenCalledTimes(3);
  });

  it('drops entries with missing ASINs as part of dedup', async () => {
    const popular = [
      { asin: 'A', title: 'Book A', author: 'X', coverArtUrl: null },
      { asin: '', title: 'Book with empty asin', author: 'X', coverArtUrl: null },
      { asin: null, title: 'Book with null asin', author: 'X', coverArtUrl: null },
      { asin: 'B', title: 'Book B', author: 'X', coverArtUrl: null },
    ];

    audibleServiceMock.getPopularAudiobooks.mockResolvedValue(popular as any);
    audibleServiceMock.getNewReleases.mockResolvedValue([]);
    thumbnailCacheMock.cleanupUnusedThumbnails.mockResolvedValue(0);
    prismaMock.audibleCache.upsert.mockResolvedValue({});
    prismaMock.audibleCacheCategory.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.audibleCacheCategory.create.mockResolvedValue({});
    prismaMock.userHomeSection.findMany.mockResolvedValue([]);
    prismaMock.audibleCache.findMany.mockResolvedValue([]);

    const { processAudibleRefresh } = await import('@/lib/processors/audible-refresh.processor');
    const result = await processAudibleRefresh({ jobId: 'job-empty-asin' });

    expect(result.popularSaved).toBe(2);

    const popularCreates = (prismaMock.audibleCacheCategory.create.mock.calls as Array<[{ data: { asin: string; categoryId: string; rank: number } }]>)
      .map((c) => c[0].data)
      .filter((d) => d.categoryId === '__popular__');
    expect(popularCreates.map((d) => d.asin)).toEqual(['A', 'B']);
    expect(popularCreates.map((d) => d.rank)).toEqual([1, 2]);
  });
});
