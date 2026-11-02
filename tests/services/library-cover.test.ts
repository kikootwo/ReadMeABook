/**
 * Component: The library cover follows an Audiobookshelf rematch (#325a)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * Runs the real ThumbnailCacheService (fs and axios mocked): an ABS item whose ASIN changed gets a
 * freshly downloaded cover under a new name (so a new URL), and the old file is deleted; an
 * unchanged ASIN reuses the file it has. Plex calls the cache exactly as before.
 */

import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({ mkdir: vi.fn(), access: vi.fn(), writeFile: vi.fn(), readdir: vi.fn(), unlink: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ get: vi.fn() }));
const files = vi.hoisted(() => new Set<string>());

vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));
vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));

const { ThumbnailCacheService } = await import('@/lib/services/thumbnail-cache.service');
const { cacheLibraryCover, coverAsinOf, libraryCoverPlan } = await import('@/lib/services/library/library-cover');
const { libraryCoverUrl } = await import('@/lib/services/library/library-display');

const ABS = { backendBaseUrl: 'http://abs:13378', authToken: 'abstoken', backendMode: 'audiobookshelf' as const };
const PLEX = { backendBaseUrl: 'http://plex:32400', authToken: 'plextoken', backendMode: 'plex' as const };
const X = 'B082BHJMFF';
const Y = 'B072R1CY4P';
const ITEM = { externalId: 'abs-item-1', coverUrl: '/api/items/abs-item-1/cover' };
const lib = (name: string) => path.join('/app/cache/library', name);
const nameOf = (p: string | null | undefined) => (p ? path.basename(p) : p);

describe('library cover follows a rematch (#325a)', () => {
  let service: InstanceType<typeof ThumbnailCacheService>;

  beforeEach(() => {
    vi.clearAllMocks();
    files.clear();
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.access.mockImplementation(async (p: string) => {
      if (!files.has(path.basename(p))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    fsMock.writeFile.mockImplementation(async (p: string) => { files.add(path.basename(p)); });
    fsMock.unlink.mockImplementation(async (p: string) => { files.delete(path.basename(p)); });
    axiosMock.get.mockResolvedValue({ data: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'image/jpeg' } });
    service = new ThumbnailCacheService();
  });

  it('a new ABS item is cached under its ASIN', async () => {
    const stored = await cacheLibraryCover(service, ABS, { ...ITEM, asin: X }, null);
    expect(nameOf(stored)).toMatch(new RegExp(`^[0-9a-f]{16}-${X}\\.jpg$`));
    expect(coverAsinOf(stored)).toBe(X);
    expect(axiosMock.get).toHaveBeenCalledTimes(1);
  });

  it('an ASIN change downloads the cover again under a new name, deletes the old file, and changes the URL', async () => {
    const first = await cacheLibraryCover(service, ABS, { ...ITEM, asin: X }, null);
    axiosMock.get.mockClear();

    const next = await cacheLibraryCover(service, ABS, { ...ITEM, asin: Y }, { asin: X, cachedLibraryCoverPath: first! });
    expect(coverAsinOf(next)).toBe(Y);
    expect(axiosMock.get).toHaveBeenCalledTimes(1);
    expect(axiosMock.get.mock.calls[0][0]).toBe('http://abs:13378/api/items/abs-item-1/cover');
    expect(libraryCoverUrl(next)).not.toBe(libraryCoverUrl(first));
    expect([...files]).toEqual([nameOf(next)]);
  });

  it('an unchanged ASIN reuses the file (no download, same path)', async () => {
    const first = await cacheLibraryCover(service, ABS, { ...ITEM, asin: X }, null);
    axiosMock.get.mockClear();
    const again = await cacheLibraryCover(service, ABS, { ...ITEM, asin: X.toLowerCase() }, { asin: X, cachedLibraryCoverPath: first! });
    expect(again).toBe(first);
    expect(axiosMock.get).not.toHaveBeenCalled();
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  it('a cover cached before this change (no ASIN in the name) is kept while the ASIN is unchanged', async () => {
    const legacy = await service.cacheLibraryThumbnail(ITEM.externalId, ITEM.coverUrl, ABS.backendBaseUrl, ABS.authToken, 'audiobookshelf');
    axiosMock.get.mockClear();
    expect(await cacheLibraryCover(service, ABS, { ...ITEM, asin: X }, { asin: X, cachedLibraryCoverPath: legacy })).toBe(legacy);
    expect(axiosMock.get).not.toHaveBeenCalled();

    const moved = await cacheLibraryCover(service, ABS, { ...ITEM, asin: Y }, { asin: X, cachedLibraryCoverPath: legacy });
    expect(coverAsinOf(moved)).toBe(Y);
    expect(axiosMock.get).toHaveBeenCalledTimes(1);
    expect(files.has(nameOf(legacy)!)).toBe(false);
  });

  it('a stale file under the new name is downloaded again, not reused', async () => {
    const first = await cacheLibraryCover(service, ABS, { ...ITEM, asin: X }, null);
    files.add(nameOf(first)!.replace(X, Y)); // left from an earlier time the item held Y
    axiosMock.get.mockClear();
    await cacheLibraryCover(service, ABS, { ...ITEM, asin: Y }, { asin: X, cachedLibraryCoverPath: first! });
    expect(axiosMock.get).toHaveBeenCalledTimes(1);
  });

  it('a rematched item whose new cover cannot be fetched stores none (never the old cover)', async () => {
    const first = await cacheLibraryCover(service, ABS, { ...ITEM, asin: X }, null);
    axiosMock.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await cacheLibraryCover(service, ABS, { ...ITEM, asin: Y }, { asin: X, cachedLibraryCoverPath: first! })).toBeNull();
    expect(files.size).toBe(0);

    // ...or that has no cover any more
    const again = await cacheLibraryCover(service, ABS, { ...ITEM, asin: X }, null);
    expect(await cacheLibraryCover(service, ABS, { ...ITEM, coverUrl: null, asin: Y }, { asin: X, cachedLibraryCoverPath: again! })).toBeNull();
  });

  it('a download failure without a rematch leaves the stored cover alone (as before)', async () => {
    axiosMock.get.mockRejectedValueOnce(new Error('timeout'));
    expect(await cacheLibraryCover(service, ABS, { ...ITEM, asin: X }, { asin: X, cachedLibraryCoverPath: null })).toBeUndefined();
  });

  it('Plex: the cache is called exactly as before (no variant), whatever the ASIN does', async () => {
    const spy = vi.spyOn(service, 'cacheLibraryThumbnail');
    const plexItem = { externalId: 'plex://guid/1', coverUrl: '/library/metadata/1/thumb', asin: Y };
    const stored = await cacheLibraryCover(service, PLEX, plexItem, { asin: X, cachedLibraryCoverPath: lib('aaaaaaaaaaaaaaaa.jpg') });
    expect(spy).toHaveBeenCalledWith('plex://guid/1', '/library/metadata/1/thumb', PLEX.backendBaseUrl, PLEX.authToken, 'plex');
    expect(spy.mock.calls[0]).toHaveLength(5);
    expect(nameOf(stored)).toMatch(/^[0-9a-f]{16}\.jpg$/);
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });
});

describe('libraryCoverPlan', () => {
  const prev = (asin: string | null, name: string | null) => ({ asin, cachedLibraryCoverPath: name && lib(name) });
  it.each([
    ['plex', 'plex', Y, prev(X, 'aaaaaaaaaaaaaaaa.jpg'), { refresh: false }],
    ['ABS new item', 'audiobookshelf', X, null, { variant: X, refresh: false }],
    ['ABS item without an ASIN', 'audiobookshelf', null, prev(null, 'aaaaaaaaaaaaaaaa.jpg'), { variant: undefined, refresh: false }],
    ['ABS ISBN-13 is not an ASIN', 'audiobookshelf', '9780553418026', prev(X, `aaaaaaaaaaaaaaaa-${X}.jpg`), { variant: X, refresh: false }],
    ['ABS same ASIN', 'audiobookshelf', X, prev(X, `aaaaaaaaaaaaaaaa-${X}.jpg`), { variant: X, refresh: false }],
    ['ABS changed ASIN', 'audiobookshelf', Y, prev(Y, `aaaaaaaaaaaaaaaa-${X}.jpg`), { variant: Y, refresh: true }],
    ['ABS legacy name, same ASIN', 'audiobookshelf', X, prev(X, 'aaaaaaaaaaaaaaaa.jpg'), { variant: undefined, refresh: false }],
    ['ABS legacy name, ASIN appeared', 'audiobookshelf', X, prev(null, 'aaaaaaaaaaaaaaaa.jpg'), { variant: X, refresh: true }],
    ['ABS no cached cover yet', 'audiobookshelf', Y, prev(X, null), { variant: Y, refresh: false }],
  ])('%s', (_label, mode, asin, previous, plan) => {
    expect(libraryCoverPlan(mode, asin, previous)).toEqual(plan);
  });
});
