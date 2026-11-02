/**
 * Component: Delivered requests follow the library's ASIN (#325a), the rule
 * Documentation: documentation/fixes/file-hash-matching.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const { followLibraryAsins, nextLibraryAsin } = await import('@/lib/services/library/follow-library-asin');

const X = 'B0REQUEST1';
const Y = 'B0LIBRARY2';
const Z = 'B0REMATCH3';
const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

const BOOK = { id: 'ab-1', title: 'Book', audibleAsin: X, libraryAsin: null as string | null, absItemId: 'abs-1' };

function seed(libraryAsin: string | null, itemAsin: string | null | undefined, rows = true) {
  prismaMock.audiobook.findMany.mockResolvedValue([{ ...BOOK, libraryAsin }]);
  prismaMock.plexLibrary.findMany.mockResolvedValue(rows ? [{ plexGuid: 'abs-1', asin: itemAsin ?? null }] : []);
}

/** The follow's compare-and-set writes (the first updateMany is the unlinked sweep). */
const writes = () => prismaMock.audiobook.updateMany.mock.calls.slice(1).map((c) => c[0]);

describe('nextLibraryAsin (the table)', () => {
  it.each([
    ['X → Y', null, Y, Y],
    ['Y → Z (rematched again)', Y, Z, Z],
    ['Z → X (back to the requested ASIN)', Z, X, null],
    ['x vs X while followed (only the case differs from the requested)', Y, X.toLowerCase(), null],
    ['x vs X, nothing followed', null, X.toLowerCase(), undefined],
    ['Y vs y while library_asin = Y', Y, Y.toLowerCase(), undefined],
    ['empty', Y, '', undefined],
    ['null', Y, null, undefined],
    ['ISBN-13', Y, '9780553418026', undefined],
    ['hyphenated ISBN', Y, '978-0-553-41802-6', undefined],
    ['padded ASIN', null, `  ${Y} `, Y],
  ])('%s', (_label, current, item, expected) => {
    expect(nextLibraryAsin(X, current, item)).toBe(expected);
  });
});

describe('followLibraryAsins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.audiobook.updateMany.mockResolvedValue({ count: 1 });
  });

  it('reads only linked books with a live available audiobook request, then their library rows', async () => {
    seed(null, Y);
    await followLibraryAsins('audiobookshelf', log as never);

    expect(prismaMock.audiobook.updateMany.mock.calls[0][0]).toEqual({
      where: { absItemId: null, libraryAsin: { not: null } },
      data: { libraryAsin: null, updatedAt: expect.any(Date) },
    });
    expect(prismaMock.audiobook.findMany.mock.calls[0][0].where).toEqual({
      absItemId: { not: null },
      requests: { some: { type: 'audiobook', status: 'available', deletedAt: null } },
    });
    expect(prismaMock.plexLibrary.findMany.mock.calls[0][0].where).toEqual({ plexGuid: { in: ['abs-1'] } });
  });

  it('writes exactly { libraryAsin, updatedAt } with a compare-and-set, and logs A -> B', async () => {
    seed(null, Y);
    const result = await followLibraryAsins('audiobookshelf', log as never);

    expect(writes()).toEqual([{
      where: { id: 'ab-1', absItemId: 'abs-1', libraryAsin: null },
      data: { libraryAsin: Y, updatedAt: expect.any(Date) },
    }]);
    expect(Object.keys(writes()[0].data).sort()).toEqual(['libraryAsin', 'updatedAt']);
    expect(result).toMatchObject({ considered: 1, followed: 1, cleared: 0 });
    expect(log.info).toHaveBeenCalledWith(`Following Audiobookshelf: "Book" library ASIN ${X} -> ${Y}`);
  });

  it('a rematch moves it, and back to the requested ASIN clears it', async () => {
    seed(Y, Z);
    await followLibraryAsins('audiobookshelf', log as never);
    expect(writes()[0]).toMatchObject({ where: { libraryAsin: Y }, data: { libraryAsin: Z } });
    expect(log.info).toHaveBeenCalledWith(`Following Audiobookshelf: "Book" library ASIN ${Y} -> ${Z}`);

    vi.clearAllMocks();
    prismaMock.audiobook.updateMany.mockResolvedValue({ count: 1 });
    seed(Z, X);
    const result = await followLibraryAsins('audiobookshelf', log as never);
    expect(writes()[0]).toMatchObject({ where: { libraryAsin: Z }, data: { libraryAsin: null } });
    expect(result.cleared).toBe(1);
  });

  it.each([
    ['ISBN-13', '9780553418026'],
    ['hyphenated ISBN', '978-0-553-41802-6'],
    ['empty', ''],
    ['null', null],
  ])('an item ASIN that is %s writes nothing', async (_label, itemAsin) => {
    seed(Y, itemAsin);
    await followLibraryAsins('audiobookshelf', log as never);
    expect(writes()).toEqual([]);
  });

  it('no library row for the item: no write', async () => {
    seed(Y, Z, false);
    await followLibraryAsins('audiobookshelf', log as never);
    expect(writes()).toEqual([]);
  });

  it('no candidate books: no library read', async () => {
    prismaMock.audiobook.findMany.mockResolvedValue([]);
    await followLibraryAsins('audiobookshelf', log as never);
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
  });

  it('a lost compare-and-set is a no-op, never a throw', async () => {
    seed(null, Y);
    prismaMock.audiobook.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    const result = await followLibraryAsins('audiobookshelf', log as never);
    expect(result.followed).toBe(0);
    expect(log.info).not.toHaveBeenCalled();
  });

  it('a failed write is logged and the run goes on', async () => {
    prismaMock.audiobook.findMany.mockResolvedValue([{ ...BOOK }, { ...BOOK, id: 'ab-2', absItemId: 'abs-2' }]);
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ plexGuid: 'abs-1', asin: Y }, { plexGuid: 'abs-2', asin: Z }]);
    prismaMock.audiobook.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ count: 1 });
    const result = await followLibraryAsins('audiobookshelf', log as never);
    expect(result.followed).toBe(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('itemIds (the recently-added check): only books linked to those items, and no unlinked sweep', async () => {
    seed(null, Y);
    const result = await followLibraryAsins('audiobookshelf', log as never, { itemIds: ['abs-1', 'abs-7'] });

    expect(prismaMock.audiobook.findMany.mock.calls[0][0].where).toEqual({
      absItemId: { in: ['abs-1', 'abs-7'] },
      requests: { some: { type: 'audiobook', status: 'available', deletedAt: null } },
    });
    expect(prismaMock.audiobook.updateMany.mock.calls.map((c) => c[0])).toEqual([{
      where: { id: 'ab-1', absItemId: 'abs-1', libraryAsin: null },
      data: { libraryAsin: Y, updatedAt: expect.any(Date) },
    }]);
    expect(result).toMatchObject({ considered: 1, followed: 1, unlinked: 0 });
  });

  it('itemIds empty: no prisma call', async () => {
    await followLibraryAsins('audiobookshelf', log as never, { itemIds: [] });
    expect(prismaMock.audiobook.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.findMany).not.toHaveBeenCalled();
  });

  it('Plex mode makes no prisma call', async () => {
    const result = await followLibraryAsins('plex', log as never);
    expect(result).toEqual({ considered: 0, followed: 0, cleared: 0, unlinked: 0 });
    expect(prismaMock.audiobook.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.findMany).not.toHaveBeenCalled();
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
  });
});
