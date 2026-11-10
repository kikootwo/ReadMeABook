/**
 * Component: Bulk Import checks tests (importable book, ASIN resolve, media-folder rows)
 * Documentation: documentation/features/bulk-import.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createPrismaMock } from '../../helpers/prisma';
import { IMPORT_BLOCKING_STATUSES } from '@/lib/constants/request-statuses';

const prismaMock = createPrismaMock();
const audibleMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn() }));
const fsMock = vi.hoisted(() => ({ realpath: vi.fn(), stat: vi.fn() }));
/** Symlinks: resolved path prefix -> real prefix. */
const links = vi.hoisted(() => new Map<string, string>());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audibleMock }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

const { getImportBlocks, resolveBookByAsin, rootKind, loadImportRoots, isInMediaFolder } = await import('@/lib/utils/bulk-import-checks');

const posix = (p: string) => path.resolve(p).replace(/\\/g, '/');

describe('getImportBlocks', () => {
  it('runs no query for no ASINs', async () => {
    expect((await getImportBlocks([])).size).toBe(0);
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
    expect(prismaMock.request.findMany).not.toHaveBeenCalled();
  });

  it('reads both tables once for many ASINs, with the scan\'s status list and any user', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValue([
      { asin: 'b0aaaaaaa1', plexGuid: 'abs-1' },
      { asin: null, plexGuid: 'com.plexapp.agents.audible://B0BBBBBBB2?lang=en' },
    ]);
    prismaMock.request.findMany.mockResolvedValue([{ audiobook: { audibleAsin: 'B0CCCCCCC3' } }]);

    const blocks = await getImportBlocks(['B0AAAAAAA1', 'B0BBBBBBB2', 'B0CCCCCCC3', 'B0DDDDDDD4', 'B0AAAAAAA1']);

    expect(Object.fromEntries(blocks)).toEqual({
      B0AAAAAAA1: { inLibrary: true, hasActiveRequest: false },
      B0BBBBBBB2: { inLibrary: true, hasActiveRequest: false },
      B0CCCCCCC3: { inLibrary: false, hasActiveRequest: true },
      B0DDDDDDD4: { inLibrary: false, hasActiveRequest: false },
    });
    expect(prismaMock.plexLibrary.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.findMany).toHaveBeenCalledTimes(1);
    const where = prismaMock.request.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      audiobook: { audibleAsin: { in: ['B0AAAAAAA1', 'B0BBBBBBB2', 'B0CCCCCCC3', 'B0DDDDDDD4'] } },
      type: 'audiobook',
      status: { in: [...IMPORT_BLOCKING_STATUSES] },
      deletedAt: null,
    });
    expect(where).not.toHaveProperty('userId');
  });

  it('keeps the status list the scan used before #189', () => {
    expect([...IMPORT_BLOCKING_STATUSES].sort()).toEqual([
      'available', 'awaiting_approval', 'awaiting_import', 'awaiting_search', 'downloaded', 'downloading', 'pending', 'processing', 'searching',
    ]);
  });
});

describe('resolveBookByAsin', () => {
  beforeEach(() => {
    prismaMock.audiobook.findFirst.mockResolvedValue(null);
    prismaMock.audibleCache.findUnique.mockResolvedValue(null);
    audibleMock.getAudiobookDetails.mockResolvedValue(null);
  });

  it('uses the audiobooks row first', async () => {
    prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'ab-1', title: 'T', author: 'A', narrator: 'N', coverArtUrl: null });

    expect(await resolveBookByAsin('B0AAAAAAA1')).toEqual({
      audiobookId: 'ab-1',
      match: { asin: 'B0AAAAAAA1', title: 'T', author: 'A', narrator: 'N', coverArtUrl: undefined },
    });
    expect(prismaMock.audibleCache.findUnique).not.toHaveBeenCalled();
  });

  it('then the cache, then a live lookup (series and year kept for the new row)', async () => {
    audibleMock.getAudiobookDetails.mockResolvedValue({
      asin: 'B0AAAAAAA1', title: 'Live', author: 'A', narrator: 'N', coverArtUrl: 'c', durationMinutes: 90,
      series: 'S', seriesPart: '2', seriesAsin: 'B0SERIES01', releaseDate: '2019-04-02',
    });

    const book = await resolveBookByAsin('B0AAAAAAA1');

    expect(prismaMock.audibleCache.findUnique).toHaveBeenCalledWith({ where: { asin: 'B0AAAAAAA1' } });
    expect(audibleMock.getAudiobookDetails).toHaveBeenCalledWith('B0AAAAAAA1', { fillSeries: true });
    expect(book?.audiobookId).toBeUndefined();
    expect(book?.newRecord).toEqual({
      audibleAsin: 'B0AAAAAAA1', title: 'Live', author: 'A', narrator: 'N', coverArtUrl: 'c',
      series: 'S', seriesPart: '2', seriesAsin: 'B0SERIES01', year: 2019,
    });
  });

  it('is null when nothing knows the ASIN', async () => {
    expect(await resolveBookByAsin('B0AAAAAAA1')).toBeNull();
  });
});

describe('rootKind (deepest root wins, media wins a tie)', () => {
  const roots = { media: ['/data/media'], others: ['/data', '/bookdrop'] };

  it.each([
    ['a download folder', '/data/torrents/Book', 'other'],
    ['media nested in downloads', '/data/media/Author/Book', 'media'],
    ['the media root itself', '/data/media', 'media'],
    ['a sibling with a shared prefix', '/data/media-old/Book', 'other'],
    ['bookdrop', '/bookdrop/Book', 'other'],
    ['outside every root', '/elsewhere/Book', null],
  ])('%s', (_label, p, kind) => {
    expect(rootKind(p, roots)).toBe(kind);
  });

  it('downloads nested in media count as downloads', () => {
    expect(rootKind('/media/downloads/Book', { media: ['/media'], others: ['/media/downloads'] })).toBe('other');
    expect(rootKind('/media/Author/Book', { media: ['/media'], others: ['/media/downloads'] })).toBe('media');
  });

  it('media wins when download_dir equals media_dir', () => {
    expect(rootKind('/srv/books/Book', { media: ['/srv/books'], others: ['/srv/books'] })).toBe('media');
  });
});

describe('isInMediaFolder', () => {
  beforeEach(() => {
    links.clear();
    fsMock.realpath.mockImplementation(async (p: string) => {
      const norm = p.replace(/\\/g, '/');
      for (const [from, to] of links) if (norm === from || norm.startsWith(`${from}/`)) return to + norm.slice(from.length);
      return p;
    });
    fsMock.stat.mockRejectedValue(new Error('ENOENT'));
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      ({ download_dir: { value: '/data' }, media_dir: { value: '/data/media' } } as Record<string, { value: string }>)[where.key] ?? null);
  });

  it('is false for a download folder', async () => {
    const roots = await loadImportRoots();
    expect(await isInMediaFolder('/data/torrents/Book', ['01.mp3'], roots)).toBe(false);
  });

  it('is true for a folder in the media folder', async () => {
    const roots = await loadImportRoots();
    expect(await isInMediaFolder('/data/media/Author/Book', ['01.mp3'], roots)).toBe(true);
  });

  it('is true for a merged entry whose files sit partly in the media folder', async () => {
    const roots = await loadImportRoots();
    expect(await isInMediaFolder('/data', ['torrents/Book/01.mp3', 'media/Author/Book/01.mp3'], roots)).toBe(true);
    expect(await isInMediaFolder('/data', ['torrents/Book/01.mp3', 'torrents/Book/02.mp3'], roots)).toBe(false);
  });

  it('follows a symlinked path into the media folder', async () => {
    links.set(posix('/data/torrents/link'), posix('/data/media/Author'));
    const roots = await loadImportRoots();
    expect(await isInMediaFolder('/data/torrents/link/Book', ['01.mp3'], roots)).toBe(true);
  });

  it('follows a symlinked media root', async () => {
    links.set(posix('/data/media'), posix('/mnt/library'));
    const roots = await loadImportRoots();
    expect(roots.media).toEqual([posix('/mnt/library')]);
    expect(await isInMediaFolder('/data/media/Author/Book', ['01.mp3'], roots)).toBe(true);
  });

  it('uses the default media folder when media_dir is unset', async () => {
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    delete process.env.MEDIA_DIR;
    const roots = await loadImportRoots();
    expect(roots).toEqual({ media: [posix('/media/audiobooks')], others: [] });
  });
});
