/**
 * Component: Library scan, the delivered-request link never records the wrong item (#284)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * Run-level guards of request matching: the book's item id is written only by a won
 * compare-and-set, a link in this run is not overwritten by another request's ASIN match, an item
 * taken earlier in the run is not handed to a later book, and each request uses its own delivery
 * time. Real: the full-scan processor, match-requests, request-library-link, audiobook-matcher.
 * Mocked: prisma (in-memory holder), config, library service, ABS fetch, thumbnails, job queue.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createLibraryDb, resetLibraryDb, wireLibraryDb, type Row } from '../helpers/library-link-db';
import { generateFilesHash } from '@/lib/utils/files-hash';

const prismaMock = createPrismaMock();
const libraryServiceMock = vi.hoisted(() => ({ getLibraryItems: vi.fn(), getRecentlyAdded: vi.fn(), getCoverCachingParams: vi.fn() }));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), getPlexConfig: vi.fn(), getMany: vi.fn(), get: vi.fn(), getAudibleRegion: vi.fn() }));
const thumbnailCacheServiceMock = vi.hoisted(() => ({ cacheLibraryThumbnail: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn() }));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: async () => libraryServiceMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/thumbnail-cache.service', () => ({ getThumbnailCacheService: () => thumbnailCacheServiceMock }));

const REQUESTED_ASIN = 'B0REQUEST1';
const LIBRARY_ASIN = 'B0LIBRARY2';
const MEDIA = '/media/audiobooks';
const FOLDER = `Author/Delivered Book ${REQUESTED_ASIN}`;
const DELIVERED = new Date('2026-10-20T12:00:00Z');
const at = (minutes: number) => new Date(DELIVERED.getTime() + minutes * 60_000);
const GENERIC = ['01.mp3', '02.mp3'];

/** RMAB's own item: RMAB's folder seen under ABS's mount, matched by ABS to another ASIN. */
const ITEM = {
  id: 'abs-1', externalId: 'abs-1', title: 'Delivered Book', author: 'Author', asin: LIBRARY_ASIN,
  path: `/audiobooks/${FOLDER}`, isMissing: false, addedAt: at(5), updatedAt: at(5),
};

const db = createLibraryDb();

function addBook(id: string, over: Row = {}): void {
  db.audiobooks.push({
    id, audibleAsin: REQUESTED_ASIN, title: 'Delivered Book', author: 'Author', narrator: null,
    filePath: `${MEDIA}/${FOLDER}`, filesHash: 'f'.repeat(64), fileFormat: 'mp3', status: 'completed',
    completedAt: DELIVERED, plexGuid: null, absItemId: null, ...over,
  });
}

function addRequest(id: string, audiobookId: string, over: Row = {}): void {
  db.requests.push({
    id, audiobookId, userId: `u-${id}`, type: 'audiobook', status: 'downloaded', deletedAt: null,
    completedAt: DELIVERED, updatedAt: DELIVERED, errorMessage: null, ...over,
  });
}

const request = (id: string) => db.requests.find((r) => r.id === id) ?? {};
const book = (id: string) => db.audiobooks.find((a) => a.id === id) ?? {};
const notifications = () => jobQueueMock.addNotificationJob.mock.calls.filter((c) => c[0] === 'request_available');
/** Another job completed the request between this run's read and its write. */
const completedMeanwhile = (requestId: string, audiobookId: string) => () => {
  Object.assign(request(requestId), { status: 'available' });
  Object.assign(book(audiobookId), { absItemId: 'abs-winner' });
};

async function fullScan() {
  const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
  return processScanPlex({ jobId: 'job-guards' });
}

describe('the library link records only the item it won (#284)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules(); // a fresh item cache per test
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
    libraryServiceMock.getLibraryItems.mockResolvedValue([{ ...ITEM }]);
    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue(null);
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  });

  it('a link that loses its compare-and-set does not write the item id', async () => {
    addBook('ab-1');
    addRequest('req-1', 'ab-1');
    db.afterRead = completedMeanwhile('req-1', 'ab-1');

    await fullScan();

    expect([request('req-1').status, book('ab-1').absItemId, notifications().length]).toEqual(['available', 'abs-winner', 0]);
  });

  it('an ASIN match that loses its compare-and-set does not write the item id', async () => {
    addBook('ab-1', { audibleAsin: LIBRARY_ASIN, filePath: null });
    addRequest('req-1', 'ab-1', { status: 'processing' });
    db.afterRead = completedMeanwhile('req-1', 'ab-1');

    await fullScan();

    expect([request('req-1').status, book('ab-1').absItemId, notifications().length]).toEqual(['available', 'abs-winner', 0]);
  });

  it('another request\'s ASIN match on the same book does not overwrite this run\'s link', async () => {
    const copy = { ...ITEM, id: 'abs-copy', externalId: 'abs-copy', asin: REQUESTED_ASIN, path: '/books2/Elsewhere/Delivered Book', addedAt: at(-400 * 24 * 60) };
    libraryServiceMock.getLibraryItems.mockResolvedValue([{ ...ITEM }, copy]);
    addBook('ab-1');
    addRequest('req-1', 'ab-1');                          // delivered: links abs-1 by path
    addRequest('req-2', 'ab-1', { status: 'pending' });   // another user: ASIN match finds the copy

    await fullScan();

    expect([request('req-1').status, request('req-2').status, book('ab-1').absItemId]).toEqual(['available', 'available', 'abs-1']);
  });

  it('an item an ASIN match took earlier in the run is not handed to a later book by files hash', async () => {
    const itemZ = { ...ITEM, id: 'abs-z', externalId: 'abs-z', asin: 'B0CCCCCCCC', path: '/audiobooks/Somewhere/Z' };
    libraryServiceMock.getLibraryItems.mockResolvedValue([itemZ]);
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.endsWith('/api/items/abs-z')) throw new Error(`unexpected ABS call ${url}`);
      return { ok: true, json: async () => ({ isMissing: false, media: { audioFiles: GENERIC.map((filename) => ({ metadata: { filename } })) } }) };
    });
    addBook('ab-d1', { audibleAsin: 'B0DDDDDDD1', filePath: `${MEDIA}/Author D1/Book D1`, filesHash: null });
    addBook('ab-c', { audibleAsin: 'B0CCCCCCCC', filePath: null });
    addBook('ab-d', { audibleAsin: 'B0DDDDDDD2', filePath: `${MEDIA}/Author D/Book D`, filesHash: generateFilesHash(GENERIC) });
    addRequest('r-d1', 'ab-d1');                      // opens the run's link context
    addRequest('r-c', 'ab-c', { status: 'pending' }); // ASIN match: abs-z
    addRequest('r-d', 'ab-d');                        // not in ABS yet; same generic file names as abs-z

    await fullScan();

    expect([request('r-c').status, book('ab-c').absItemId]).toEqual(['available', 'abs-z']);
    expect([request('r-d').status, book('ab-d').absItemId]).toEqual(['downloaded', null]);
  });

  it('each request on a book uses its own delivery time', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.endsWith('/api/items/abs-1')) throw new Error(`unexpected ABS call ${url}`);
      return { ok: true, json: async () => ({ isMissing: false, media: { audioFiles: [{ metadata: { filename: 'other.m4b' } }] } }) };
    });
    addBook('ab-1');
    addRequest('req-later', 'ab-1', { completedAt: at(120), updatedAt: at(120) }); // the item predates this delivery
    addRequest('req-1', 'ab-1');                                                   // the item came 5 min after this one

    await fullScan();

    expect([request('req-1').status, book('ab-1').absItemId]).toEqual(['available', 'abs-1']);
    expect(notifications()).toHaveLength(1);
  });
});
