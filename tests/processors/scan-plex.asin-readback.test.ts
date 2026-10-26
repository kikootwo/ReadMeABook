/**
 * Component: ABS ASIN read-back regression tests (#287)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * A scan (or recently-added check) that triggers an Audiobookshelf match must store the ASIN
 * from the match response at once, so the request check (findPlexMatch, real here) finds the
 * book in the same window instead of after the next full scan.
 * Real: audiobookshelf/api.ts, match-missing-asins.ts, audiobook-matcher.ts.
 * Mocked: fetch (ABS HTTP), prisma (in-memory plex_library), config, library service,
 * thumbnail cache, job queue.
 */

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
  getAudibleRegion: vi.fn(),
}));
const thumbnailCacheServiceMock = vi.hoisted(() => ({ cacheLibraryThumbnail: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn() }));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: async () => libraryServiceMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/thumbnail-cache.service', () => ({ getThumbnailCacheService: () => thumbnailCacheServiceMock }));

const ASIN = 'B0TEST1234';
const ITEM = {
  id: 'abs-1',
  externalId: 'abs-1',
  title: 'Unmatched Book',
  author: 'Some Author',
  asin: undefined as string | undefined,
  addedAt: new Date('2026-10-01T00:00:00Z'),
};

/** In-memory plex_library, wired into the prisma mock in beforeEach (plain holder, not a factory impl). */
const db = { rows: [] as any[] };

function wirePlexLibrary() {
  const byGuid = (guid: string) => db.rows.find(r => r.plexGuid === guid) ?? null;
  prismaMock.plexLibrary.findFirst.mockImplementation(async (a: any) => byGuid(a.where.plexGuid));
  prismaMock.plexLibrary.findUnique.mockImplementation(async (a: any) => byGuid(a.where.plexGuid));
  prismaMock.plexLibrary.create.mockImplementation(async (a: any) => {
    const row = { id: `row-${db.rows.length + 1}`, asin: null, ...a.data };
    db.rows.push(row);
    return row;
  });
  prismaMock.plexLibrary.update.mockImplementation(async (a: any) => {
    const row = a.where.id ? db.rows.find(r => r.id === a.where.id) : byGuid(a.where.plexGuid);
    Object.assign(row, a.data);
    return row;
  });
  prismaMock.plexLibrary.updateMany.mockImplementation(async (a: any) => {
    const rows = db.rows.filter(r => r.plexGuid === a.where.plexGuid);
    rows.forEach(r => Object.assign(r, a.data));
    return { count: rows.length };
  });
  prismaMock.plexLibrary.findMany.mockImplementation(async (a: any) => {
    const w = a?.where;
    if (w?.OR) {
      return db.rows.filter(r => w.OR.some((c: any) =>
        (c.asin !== undefined && r.asin === c.asin) || (c.plexGuid?.contains && r.plexGuid.includes(c.plexGuid.contains))));
    }
    if (w?.plexGuid?.notIn) {
      return db.rows.filter(r => r.plexLibraryId === w.plexLibraryId && !w.plexGuid.notIn.includes(r.plexGuid));
    }
    return db.rows;
  });
}

/** ABS over HTTP: GET /items/:id (no files → no hash), POST /items/:id/match → matchBody. */
function stubAbs(matchBody: unknown) {
  fetchMock.mockImplementation(async (url: string, init: any) => {
    if (url === 'http://abs/api/items/abs-1' && (init?.method ?? 'GET') === 'GET') {
      return { ok: true, json: async () => ({ id: 'abs-1', media: { audioFiles: [] } }) };
    }
    if (url === 'http://abs/api/items/abs-1/match' && init?.method === 'POST') {
      return { ok: true, json: async () => matchBody };
    }
    throw new Error(`unexpected ABS call ${init?.method ?? 'GET'} ${url}`);
  });
}

const MATCHED = { updated: true, libraryItem: { id: 'abs-1', media: { metadata: { title: 'Unmatched Book', asin: ASIN } } } };

function downloadedRequest() {
  return {
    id: 'req-1',
    status: 'downloaded',
    audiobook: { id: 'ab-1', audibleAsin: ASIN, title: 'Unmatched Book', author: 'Some Author', narrator: null },
    user: { plexUsername: 'reader' },
  };
}

describe('ASIN read-back after the Audiobookshelf match (#287)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    db.rows = [];
    wirePlexLibrary();

    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.getAudibleRegion.mockResolvedValue('us');
    configMock.get.mockImplementation(async (key: string) => ({
      'audiobookshelf.server_url': 'http://abs',
      'audiobookshelf.api_token': 'token',
      'audiobookshelf.library_id': 'lib-1',
    } as Record<string, string>)[key] ?? null);
    configMock.getMany.mockResolvedValue({
      'audiobookshelf.server_url': 'http://abs',
      'audiobookshelf.api_token': 'token',
      'audiobookshelf.library_id': 'lib-1',
    });
    libraryServiceMock.getCoverCachingParams.mockResolvedValue({ backendBaseUrl: 'http://abs', authToken: 'token', backendMode: 'audiobookshelf' });
    libraryServiceMock.getLibraryItems.mockResolvedValue([{ ...ITEM }]);
    libraryServiceMock.getRecentlyAdded.mockResolvedValue([{ ...ITEM }]);
    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue(null);
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);

    prismaMock.audiobook.findFirst.mockResolvedValue(null); // no file-hash match
    prismaMock.audiobook.findMany.mockResolvedValue([]); // no orphans
    prismaMock.request.findMany.mockResolvedValue([]);
  });

  it('full scan: a request check in the same window finds the matched ASIN', async () => {
    stubAbs(MATCHED);
    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    const { findPlexMatch } = await import('@/lib/utils/audiobook-matcher');

    await processScanPlex({ jobId: 'job-1' } as any);

    const match = await findPlexMatch({ asin: ASIN, title: 'Unmatched Book', author: 'Some Author' });
    expect(match?.plexGuid).toBe('abs-1');
    expect(db.rows[0].asin).toBe(ASIN);
  });

  it('full scan: a downloaded request for the matched ASIN goes available in the same scan', async () => {
    stubAbs(MATCHED);
    prismaMock.request.findMany.mockResolvedValue([downloadedRequest()]);
    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');

    const result = await processScanPlex({ jobId: 'job-2' } as any);

    expect(result.matchedDownloads).toBe(1);
    expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'req-1' },
      data: expect.objectContaining({ status: 'available' }),
    }));
  });

  it('recently-added check: the matched ASIN is stored at once', async () => {
    stubAbs(MATCHED);
    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');
    const { findPlexMatch } = await import('@/lib/utils/audiobook-matcher');

    await processPlexRecentlyAddedCheck({ jobId: 'job-3' });

    const match = await findPlexMatch({ asin: ASIN, title: 'Unmatched Book', author: 'Some Author' });
    expect(match?.plexGuid).toBe('abs-1');
  });

  it('full scan: no match leaves the row without an ASIN', async () => {
    stubAbs({ warning: 'No audible match found' });
    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');

    await processScanPlex({ jobId: 'job-4' } as any);

    expect(db.rows[0].asin ?? null).toBeNull();
  });
});
