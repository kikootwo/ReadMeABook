/**
 * Component: Library Scan, book removed from the library (#214)
 * Documentation: documentation/backend/services/scheduler.md
 *
 * When a delivered book leaves the library, both scan sites that move its
 * 'available' requests on (stale library record, orphaned audiobook) make it
 * 'failed' ("Removed from library") when no audio is left in its organized
 * folder, and keep 'downloaded' (wait for the next match) while audio is there.
 */

import fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
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

/** Written literally: the stored text must not change (existing rows are matched by equality). */
const REMOVED_MESSAGE = 'Removed from library. Request it again to download it.';

let root: string;
const folders = {} as Record<'present' | 'gone' | 'coverOnly' | 'ebookOnly' | 'discs' | 'tooDeep', string>;

/** Create `folder` holding `files` (paths relative to it). */
async function folderWith(folder: string, files: string[]): Promise<string> {
  await fs.mkdir(folder, { recursive: true });
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(folder, file)), { recursive: true });
    await fs.writeFile(path.join(folder, file), 'data');
  }
  return folder;
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-214-'));
  const author = path.join(root, 'Author');
  folders.present = await folderWith(path.join(author, 'Kept Book'), ['Kept Book.m4b', 'cover.jpg']);
  folders.gone = path.join(author, 'Deleted Book'); // never created: the user deleted it
  folders.coverOnly = await folderWith(path.join(author, 'Cover Left'), ['cover.jpg']);
  folders.ebookOnly = await folderWith(path.join(author, 'Ebook Left'), ['Ebook Left.epub', 'cover.jpg']);
  folders.discs = await folderWith(path.join(author, 'Disc Book'), ['cover.jpg', 'Disc 1/01.mp3', 'Disc 2/01.mp3']);
  folders.tooDeep = await folderWith(path.join(author, 'Deep Book'), ['cover.jpg', 'extras/old/01.mp3']);
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

/** Scan with one stale book at `filePath`; returns the data its request was updated with. */
async function scanStaleBookAt(filePath: string | null): Promise<Record<string, unknown>> {
  await scan({ stale: [{ id: 'ab-x', title: 'Some Book', filePath, requests: [{ id: 'req-x', status: 'available' }] }] });
  return requestUpdates()['req-x'];
}

/** The data each request was updated with, by request id. */
function requestUpdates(): Record<string, Record<string, unknown>> {
  const calls = prismaMock.request.update.mock.calls as [{ where: { id: string }; data: Record<string, unknown> }][];
  return Object.fromEntries(calls.map(([args]) => [args.where.id, args.data]));
}

/** Make `method` reject with `code` for `target` only (real behavior for every other path). */
function rejectFor(method: 'stat' | 'readdir', target: string, code: string) {
  const real = fs[method].bind(fs) as (...args: unknown[]) => Promise<unknown>;
  const spy = vi.spyOn(fs, method).mockImplementation((async (p: unknown, ...rest: unknown[]) => {
    if (p === target) throw Object.assign(new Error(`${code}: ${method} ${target}`), { code });
    return real(p, ...rest);
  }) as never);
  onTestFinished(() => spy.mockRestore());
  return spy;
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
    const result = await scan({ stale: [{ id: 'ab-1', title: 'Deleted Book', filePath: folders.gone, requests: [{ id: 'req-1', status: 'available' }] }] });

    expect(result.success).toBe(true);
    expect(requestUpdates()['req-1']).toMatchObject({ status: 'failed', errorMessage: REMOVED_MESSAGE });
    expect(prismaMock.plexLibrary.delete).toHaveBeenCalledWith({ where: { id: 'stale-1' } });
  });

  it('orphaned audiobook, folder gone: the request becomes failed "Removed from library"', async () => {
    await scan({ linked: [{ id: 'ab-2', title: 'Deleted Book', filePath: folders.gone, absItemId: 'missing-guid', requests: [{ id: 'req-2', status: 'available' }] }] });

    expect(requestUpdates()['req-2']).toMatchObject({ status: 'failed', errorMessage: REMOVED_MESSAGE });
  });

  it('no organized folder on record: the request becomes failed (nothing left to wait for)', async () => {
    expect(await scanStaleBookAt(null)).toMatchObject({ status: 'failed', errorMessage: REMOVED_MESSAGE });
  });

  it.each([
    ['only cover.jpg', 'coverOnly'],
    ['only an ebook and its cover', 'ebookOnly'],
    ['audio deeper than a disc folder only', 'tooDeep'],
  ] as const)('folder left with %s: the request becomes failed', async (_label, folder) => {
    expect(await scanStaleBookAt(folders[folder])).toMatchObject({ status: 'failed', errorMessage: REMOVED_MESSAGE });
  });

  it.each(['stale', 'linked'] as const)('%s site, m4b still in the folder: the request stays downloaded with no error', async (site) => {
    const book: Book = { id: 'ab-4', title: 'Kept Book', filePath: folders.present, absItemId: 'missing-guid', requests: [{ id: 'req-4', status: 'available' }] };
    await scan({ [site]: [book] });

    expect(requestUpdates()['req-4'].status).toBe('downloaded');
    expect(requestUpdates()['req-4']).not.toHaveProperty('errorMessage');
  });

  it('audio in disc folders under the book folder: the request stays downloaded', async () => {
    expect(await scanStaleBookAt(folders.discs)).toMatchObject({ status: 'downloaded' });
  });

  it('book folder that cannot be checked (EACCES on stat): counts as present, stays downloaded', async () => {
    const stat = rejectFor('stat', folders.gone, 'EACCES');

    expect(await scanStaleBookAt(folders.gone)).toMatchObject({ status: 'downloaded' });
    expect(stat).toHaveBeenCalledWith(folders.gone);
  });

  it('book folder that cannot be listed (EACCES on readdir): counts as present, stays downloaded', async () => {
    const readdir = rejectFor('readdir', folders.coverOnly, 'EACCES');

    expect(await scanStaleBookAt(folders.coverOnly)).toMatchObject({ status: 'downloaded' });
    expect(readdir).toHaveBeenCalledWith(folders.coverOnly, expect.anything());
  });

  it('book still in the library: its request is not touched', async () => {
    await scan({ linked: [{ id: 'ab-5', title: 'Current Book', filePath: folders.gone, plexGuid: 'guid-1', requests: [{ id: 'req-5', status: 'available' }] }] });

    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
  });

  it('only available requests move: a failed or cancelled one on the same book is left alone', async () => {
    await scan({
      stale: [{
        id: 'ab-6', title: 'Deleted Book', filePath: folders.gone,
        requests: [{ id: 'req-6a', status: 'available' }, { id: 'req-6b', status: 'cancelled' }, { id: 'req-6c', status: 'failed' }],
      }],
    });

    expect(Object.keys(requestUpdates())).toEqual(['req-6a']);
  });

  it('queues no search, download or notification for the removed book', async () => {
    await scan({ stale: [{ id: 'ab-7', title: 'Deleted Book', filePath: folders.gone, requests: [{ id: 'req-7', status: 'available' }] }] });

    expect(requestUpdates()['req-7'].status).toBe('failed');
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  });
});
