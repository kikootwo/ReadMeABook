/**
 * Component: Library scans, a delivered request follows its Audiobookshelf item's ASIN (#325a)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * RMAB delivered book X; Audiobookshelf holds the folder as Y and may be rematched later (Z, back
 * to X). Before the change the book kept showing X's edition forever. Real: both processors,
 * match-requests, request-library-link, follow-library-asin, library-removal, audiobook-matcher.
 * Mocked: prisma (in-memory holder), config, library service, ABS fetch, thumbnail cache, job queue.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createLibraryDb, resetLibraryDb, wireLibraryDb } from '../helpers/library-link-db';

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
  getAudibleRegion: vi.fn(),
}));
const thumbnailCacheServiceMock = vi.hoisted(() => ({ cacheLibraryThumbnail: vi.fn(), deleteLibraryThumbnail: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn() }));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: async () => libraryServiceMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/thumbnail-cache.service', () => ({ getThumbnailCacheService: () => thumbnailCacheServiceMock }));

const X = 'B0REQUEST1';
const Y = 'B0LIBRARY2';
const Z = 'B0REMATCH3';
const MEDIA = '/media/audiobooks';
const FOLDER = `Author/Delivered Book ${X}`;
const DELIVERED = new Date('2026-10-20T12:00:00Z');

const item = (asin: string, id = 'abs-1') => ({
  id, externalId: id, title: 'Library Edition', author: 'Library Author', asin,
  path: `/audiobooks/${FOLDER}`, isMissing: false,
  addedAt: new Date('2026-10-20T12:05:00Z'), updatedAt: new Date('2026-10-20T12:05:00Z'),
});

const db = createLibraryDb();

function seedDelivered(status = 'downloaded') {
  db.audiobooks.push({
    id: 'ab-1', audibleAsin: X, title: 'Delivered Book', author: 'Author', narrator: 'Reader', series: 'Saga', year: 2020,
    filePath: `${MEDIA}/${FOLDER}`, filesHash: 'f'.repeat(64), status: 'completed', completedAt: DELIVERED,
    plexGuid: null, absItemId: null, libraryAsin: null,
  });
  db.requests.push({
    id: 'req-1', audiobookId: 'ab-1', userId: 'u-1', type: 'audiobook',
    status, deletedAt: null, completedAt: DELIVERED, updatedAt: DELIVERED, errorMessage: null,
  });
}

const book = () => db.audiobooks.find((a) => a.id === 'ab-1') ?? {};
const request = () => db.requests.find((r) => r.id === 'req-1') ?? {};
const listed = (asin: string) => {
  libraryServiceMock.getLibraryItems.mockResolvedValue([item(asin)]);
  libraryServiceMock.getRecentlyAdded.mockResolvedValue([item(asin)]);
};

/** Fields the follow must never write (ownership, folder naming and ebook search read them). */
const REQUESTED = { audibleAsin: X, title: 'Delivered Book', author: 'Author', narrator: 'Reader', series: 'Saga', year: 2020 };

describe('a delivered request follows the ASIN of its Audiobookshelf item (#325a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string) => {
      throw new Error(`unexpected ABS call ${url}`);
    });
    resetLibraryDb(db);
    wireLibraryDb(prismaMock, db, MEDIA);

    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.getAudibleRegion.mockResolvedValue('us');
    const config: Record<string, string> = {
      'audiobookshelf.server_url': 'http://abs',
      'audiobookshelf.api_token': 'token',
      'audiobookshelf.library_id': 'lib-1',
    };
    configMock.get.mockImplementation(async (key: string) => config[key] ?? null);
    configMock.getMany.mockResolvedValue(config);
    libraryServiceMock.getCoverCachingParams.mockResolvedValue({ backendBaseUrl: 'http://abs', authToken: 'token', backendMode: 'audiobookshelf' });
    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue(null);
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  });

  it('full scan: linked and followed in the same run; rematches move it; back to X clears it', async () => {
    seedDelivered();
    listed(Y);
    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');

    await processScanPlex({ jobId: 'job-1' });
    expect(request().status).toBe('available');
    expect(book()).toMatchObject({ absItemId: 'abs-1', libraryAsin: Y, ...REQUESTED });

    listed(Z);
    await processScanPlex({ jobId: 'job-2' });
    expect(book()).toMatchObject({ absItemId: 'abs-1', libraryAsin: Z, ...REQUESTED });

    listed(X.toLowerCase());
    await processScanPlex({ jobId: 'job-3' });
    expect(book()).toMatchObject({ absItemId: 'abs-1', libraryAsin: null, ...REQUESTED });
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledTimes(1);
  });

  it('recently-added check: the same follow', async () => {
    seedDelivered();
    listed(Y);
    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');

    await processPlexRecentlyAddedCheck({ jobId: 'job-4' });

    expect(request().status).toBe('available');
    expect(book()).toMatchObject({ absItemId: 'abs-1', libraryAsin: Y, ...REQUESTED });
  });

  it('an item with an ISBN instead of an ASIN never blanks the followed value', async () => {
    seedDelivered();
    listed(Y);
    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    await processScanPlex({ jobId: 'job-5' });

    db.plex[0].asin = '978-0-553-41802-6';
    listed('978-0-553-41802-6');
    await processScanPlex({ jobId: 'job-6' });

    expect(book().libraryAsin).toBe(Y);
  });

  it('stale removal (item gone from the list) clears the library ASIN with the link', async () => {
    seedDelivered();
    listed(Y);
    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    await processScanPlex({ jobId: 'job-7' });
    expect(book().libraryAsin).toBe(Y);

    libraryServiceMock.getLibraryItems.mockResolvedValue([item(Y, 'abs-other')]);
    await processScanPlex({ jobId: 'job-8' });

    expect(book()).toMatchObject({ absItemId: null, libraryAsin: null, audibleAsin: X });
  });

  it('orphan reset (link to a row that no longer exists) clears the library ASIN', async () => {
    seedDelivered('available');
    Object.assign(book(), { absItemId: 'abs-gone', libraryAsin: Y });
    listed(Y);
    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');

    await processScanPlex({ jobId: 'job-9' });

    expect(book()).toMatchObject({ absItemId: null, libraryAsin: null, audibleAsin: X });
  });

  it('a book left unlinked by a delete or replace keeps no library ASIN after the next run', async () => {
    seedDelivered('available');
    Object.assign(book(), { absItemId: null, libraryAsin: Y });
    request().deletedAt = new Date(); // the request delete soft-deletes and clears the item id
    listed(Y);
    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');
    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');

    await processPlexRecentlyAddedCheck({ jobId: 'job-10' }); // scoped to the items it listed: no sweep
    expect(book()).toMatchObject({ absItemId: null, libraryAsin: Y });

    await processScanPlex({ jobId: 'job-10b' });
    expect(book()).toMatchObject({ absItemId: null, libraryAsin: null });
  });

  it('recently-added check: follows only books linked to the items it listed', async () => {
    seedDelivered('available');
    Object.assign(book(), { absItemId: 'abs-1' });
    db.plex.push({ id: 'row-1', plexGuid: 'abs-1', asin: Y, filePath: `/audiobooks/${FOLDER}` });
    db.plex.push({ id: 'row-9', plexGuid: 'abs-9', asin: Z, filePath: '/audiobooks/Other/Book' });
    db.audiobooks.push({ ...book(), id: 'ab-9', audibleAsin: 'B0OTHER009', absItemId: 'abs-9', filePath: `${MEDIA}/Other/Book` });
    db.requests.push({ ...request(), id: 'req-9', audiobookId: 'ab-9' });
    listed(Y);
    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');

    await processPlexRecentlyAddedCheck({ jobId: 'job-12' });

    expect(book().libraryAsin).toBe(Y);
    expect(db.audiobooks.find((a) => a.id === 'ab-9')?.libraryAsin).toBeNull();
  });

  it('a re-link to the same item keeps the library ASIN, even when the item lists no ASIN', async () => {
    seedDelivered();
    Object.assign(book(), { absItemId: 'abs-1', libraryAsin: Y });
    libraryServiceMock.getRecentlyAdded.mockResolvedValue([{ ...item(''), asin: undefined }]);
    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');

    await processPlexRecentlyAddedCheck({ jobId: 'job-13' });

    expect(request().status).toBe('available');
    expect(book()).toMatchObject({ absItemId: 'abs-1', libraryAsin: Y, audibleAsin: X });
  });

  it('the cached library cover is fetched again under a new name when the item ASIN changes, and reused otherwise', async () => {
    seedDelivered();
    const cover = (asin: string) => `/app/cache/library/0123456789abcdef-${asin}.jpg`;
    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockImplementation(async (...args: unknown[]) =>
      cover((args[5] as { variant: string }).variant));
    const withCover = (asin: string) => [{ ...item(asin), coverUrl: '/api/items/abs-1/cover' }];
    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');

    libraryServiceMock.getLibraryItems.mockResolvedValue(withCover(Y));
    await processScanPlex({ jobId: 'job-14' });
    expect(db.plex[0].cachedLibraryCoverPath).toBe(cover(Y));
    expect(thumbnailCacheServiceMock.cacheLibraryThumbnail.mock.calls[0][5]).toEqual({ variant: Y, refresh: false });

    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockClear();
    await processScanPlex({ jobId: 'job-15' }); // unchanged
    expect(thumbnailCacheServiceMock.cacheLibraryThumbnail.mock.calls[0][5]).toEqual({ variant: Y, refresh: false });
    expect(thumbnailCacheServiceMock.deleteLibraryThumbnail).not.toHaveBeenCalled();

    libraryServiceMock.getRecentlyAdded.mockResolvedValue(withCover(Z));
    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockClear();
    await processPlexRecentlyAddedCheck({ jobId: 'job-16' }); // rematched
    expect(thumbnailCacheServiceMock.cacheLibraryThumbnail.mock.calls[0][5]).toEqual({ variant: Z, refresh: true });
    expect(thumbnailCacheServiceMock.deleteLibraryThumbnail).toHaveBeenCalledWith(cover(Y));
    expect(db.plex[0].cachedLibraryCoverPath).toBe(cover(Z));
    expect(book().libraryAsin).toBe(Z);
  });

  it('upgrade: a cover cached before the upgrade (legacy name) is fetched again once for the followed book; the old file is removed', async () => {
    // 1.2.13 delivered X, linked the item, and cached its cover as <hash>.jpg; ABS was then rematched to Y
    seedDelivered('available');
    Object.assign(book(), { absItemId: 'abs-1' });
    const legacy = '/app/cache/library/0123456789abcdef.jpg';
    db.plex.push({ id: 'row-1', plexGuid: 'abs-1', title: 'Delivered Book', author: 'Author', asin: Y, filePath: `/audiobooks/${FOLDER}`, cachedLibraryCoverPath: legacy });
    const cover = (asin: string) => `/app/cache/library/0123456789abcdef-${asin}.jpg`;
    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockImplementation(async (...args: unknown[]) =>
      cover((args[5] as { variant: string }).variant));
    libraryServiceMock.getLibraryItems.mockResolvedValue([{ ...item(Y), coverUrl: '/api/items/abs-1/cover' }]);
    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');

    await processScanPlex({ jobId: 'job-17' });
    expect(thumbnailCacheServiceMock.cacheLibraryThumbnail.mock.calls[0][5]).toEqual({ variant: Y, refresh: true });
    expect(thumbnailCacheServiceMock.deleteLibraryThumbnail).toHaveBeenCalledWith(legacy);
    expect(db.plex[0].cachedLibraryCoverPath).toBe(cover(Y));
    expect(book().libraryAsin).toBe(Y);

    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockClear();
    thumbnailCacheServiceMock.deleteLibraryThumbnail.mockClear();
    await processScanPlex({ jobId: 'job-18' }); // once only
    expect(thumbnailCacheServiceMock.cacheLibraryThumbnail.mock.calls[0][5]).toEqual({ variant: Y, refresh: false });
    expect(thumbnailCacheServiceMock.deleteLibraryThumbnail).not.toHaveBeenCalled();
  });

  it('a re-link to another item starts with no library ASIN until that item has one', async () => {
    seedDelivered();
    Object.assign(book(), { absItemId: 'abs-old', libraryAsin: Y });
    libraryServiceMock.getLibraryItems.mockResolvedValue([{ ...item(''), asin: undefined }]);
    libraryServiceMock.getRecentlyAdded.mockResolvedValue([{ ...item(''), asin: undefined }]);
    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');

    await processPlexRecentlyAddedCheck({ jobId: 'job-11' });

    expect(request().status).toBe('available');
    expect(book()).toMatchObject({ absItemId: 'abs-1', libraryAsin: null, audibleAsin: X });
  });

  it('Plex backend: no follow', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    const { followLibraryAsins } = await import('@/lib/services/library/follow-library-asin');
    const log = { info: vi.fn(), debug: vi.fn(), error: vi.fn() };

    const result = await followLibraryAsins('plex', log as never);

    expect(result).toEqual({ considered: 0, followed: 0, cleared: 0, unlinked: 0 });
    expect(prismaMock.audiobook.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.findMany).not.toHaveBeenCalled();
  });
});
