/**
 * Component: Library Scan, book removed from the library (#214)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * When a delivered book leaves the library, both scan sites that move its
 * 'available' requests on (stale library record, orphaned audiobook) make it
 * 'failed' ("Removed from library") when its organized folder is gone too, and
 * keep 'downloaded' (wait for the next match) while the folder is still there.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const libraryServiceMock = vi.hoisted(() => ({ getLibraryItems: vi.fn(), getCoverCachingParams: vi.fn() }));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn(), getPlexConfig: vi.fn(), get: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn(() => Promise.resolve()), addSearchJob: vi.fn() }));

vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn() }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: () => libraryServiceMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/thumbnail-cache.service', () => ({
  getThumbnailCacheService: () => ({ cacheLibraryThumbnail: vi.fn(async () => null) }),
}));

let root: string;
let presentFolder: string;
let goneFolder: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-214-'));
  presentFolder = path.join(root, 'Author', 'Kept Book');
  await fs.mkdir(presentFolder, { recursive: true });
  await fs.writeFile(path.join(presentFolder, 'Kept Book.m4b'), 'audio');
  goneFolder = path.join(root, 'Author', 'Deleted Book'); // never created: the user deleted it
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

interface Book { id: string; title: string; filePath: string | null; plexGuid?: string | null; absItemId?: string | null; requests: { id: string; status: string }[] }

/** One plex scan: `guid-1` is still in the library; `stale` books hang off a vanished record, `linked` books are orphan candidates. */
async function scan({ stale = [], linked = [] }: { stale?: Book[]; linked?: Book[] }) {
  libraryServiceMock.getLibraryItems.mockResolvedValue([
    { id: 'rating-1', externalId: 'guid-1', title: 'Current Book', author: 'Author', addedAt: new Date(), updatedAt: new Date() },
  ]);
  prismaMock.plexLibrary.findFirst.mockResolvedValue({ id: 'lib-row-1', plexGuid: 'guid-1' });
  prismaMock.plexLibrary.findMany
    .mockResolvedValueOnce(stale.length ? [{ id: 'stale-1', plexGuid: 'stale-guid', title: stale[0].title }] : [])
    .mockResolvedValueOnce([{ plexGuid: 'guid-1' }]);
  if (stale.length) prismaMock.audiobook.findMany.mockResolvedValueOnce(stale);
  prismaMock.audiobook.findMany.mockResolvedValueOnce(linked);

  const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
  return processScanPlex({ jobId: 'job-214' });
}

/** The data each request was updated with, by request id. */
function requestUpdates(): Record<string, Record<string, unknown>> {
  const calls = prismaMock.request.update.mock.calls as [{ where: { id: string }; data: Record<string, unknown> }][];
  return Object.fromEntries(calls.map(([args]) => [args.where.id, args.data]));
}

beforeEach(async () => {
  vi.clearAllMocks();
  configMock.getBackendMode.mockResolvedValue('plex');
  configMock.getPlexConfig.mockResolvedValue({ serverUrl: 'http://plex', authToken: 't', libraryId: 'lib-1', machineIdentifier: 'm' });
  libraryServiceMock.getCoverCachingParams.mockResolvedValue({ backendBaseUrl: 'http://plex', authToken: 't', backendMode: 'plex' });
  prismaMock.plexLibrary.update.mockResolvedValue({});
  prismaMock.plexLibrary.delete.mockResolvedValue({});
  prismaMock.audiobook.update.mockResolvedValue({});
  prismaMock.request.update.mockResolvedValue({});
  prismaMock.request.findMany.mockResolvedValue([]); // nothing to match afterwards
  const matcher = await import('@/lib/utils/audiobook-matcher');
  (matcher.findPlexMatch as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe('library scan: delivered book removed from the library (#214)', () => {
  it('stale library record, folder gone: the request becomes failed "Removed from library"', async () => {
    const result = await scan({ stale: [{ id: 'ab-1', title: 'Deleted Book', filePath: goneFolder, requests: [{ id: 'req-1', status: 'available' }] }] });

    expect(result.success).toBe(true);
    expect(requestUpdates()['req-1']).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('Removed from library') });
    expect(prismaMock.plexLibrary.delete).toHaveBeenCalledWith({ where: { id: 'stale-1' } });
  });

  it('orphaned audiobook, folder gone: the request becomes failed "Removed from library"', async () => {
    await scan({ linked: [{ id: 'ab-2', title: 'Deleted Book', filePath: goneFolder, absItemId: 'missing-guid', requests: [{ id: 'req-2', status: 'available' }] }] });

    expect(requestUpdates()['req-2']).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('Removed from library') });
  });

  it('no organized folder on record: the request becomes failed (nothing left to wait for)', async () => {
    await scan({ stale: [{ id: 'ab-3', title: 'Matched Only', filePath: null, requests: [{ id: 'req-3', status: 'available' }] }] });

    expect(requestUpdates()['req-3']).toMatchObject({ status: 'failed', errorMessage: expect.stringContaining('Removed from library') });
  });

  it.each(['stale', 'linked'] as const)('%s site, folder still on disk: the request stays downloaded with no error', async (site) => {
    const book: Book = { id: 'ab-4', title: 'Kept Book', filePath: presentFolder, absItemId: 'missing-guid', requests: [{ id: 'req-4', status: 'available' }] };
    await scan({ [site]: [book] });

    expect(requestUpdates()['req-4'].status).toBe('downloaded');
    expect(requestUpdates()['req-4']).not.toHaveProperty('errorMessage');
  });

  it('book still in the library: its request is not touched', async () => {
    await scan({ linked: [{ id: 'ab-5', title: 'Current Book', filePath: goneFolder, plexGuid: 'guid-1', requests: [{ id: 'req-5', status: 'available' }] }] });

    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
  });

  it('only available requests move: a failed or cancelled one on the same book is left alone', async () => {
    await scan({
      stale: [{
        id: 'ab-6', title: 'Deleted Book', filePath: goneFolder,
        requests: [{ id: 'req-6a', status: 'available' }, { id: 'req-6b', status: 'cancelled' }, { id: 'req-6c', status: 'failed' }],
      }],
    });

    expect(Object.keys(requestUpdates())).toEqual(['req-6a']);
  });

  it('queues no search, download or notification for the removed book', async () => {
    await scan({ stale: [{ id: 'ab-7', title: 'Deleted Book', filePath: goneFolder, requests: [{ id: 'req-7', status: 'available' }] }] });

    expect(requestUpdates()['req-7'].status).toBe('failed');
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  });
});
