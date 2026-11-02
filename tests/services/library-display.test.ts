/**
 * Component: Request display follows the library (#325a), the overlay
 * Documentation: documentation/fixes/file-hash-matching.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const { loadLinkedRows, withLibraryDisplay, withLibraryDisplayAll, libraryCoverUrl } = await import('@/lib/services/library/library-display');

const BOOK = {
  id: 'ab-1', audibleAsin: 'B0REQUEST1', libraryAsin: 'B0LIBRARY2', absItemId: 'abs-1',
  title: 'Requested Title', author: 'Requested Author', narrator: 'Requested Reader', coverArtUrl: 'https://m.media-amazon.com/x.jpg',
  series: 'Saga', year: 2020, description: 'Requested blurb',
};
const ROW = { plexGuid: 'abs-1', title: 'Library Title', author: 'Library Author', narrator: 'Library Reader', cachedLibraryCoverPath: '/app/cache/library/abs-1.jpg' };
const rows = (row = ROW) => new Map([[row.plexGuid, row]]);

describe('withLibraryDisplay', () => {
  it('overlays title, author, narrator and cover; keeps audibleAsin, series, year, description', () => {
    expect(withLibraryDisplay(BOOK, rows(), 'audiobook')).toEqual({
      ...BOOK,
      libraryAsin: 'B0LIBRARY2',
      title: 'Library Title',
      author: 'Library Author',
      narrator: 'Library Reader',
      coverArtUrl: '/api/cache/library/abs-1.jpg',
    });
  });

  it("treats empty values and ABS's 'Unknown Author' as missing, and keeps the stored cover without a cached one", () => {
    const shown = withLibraryDisplay(BOOK, rows({ ...ROW, title: ' ', author: 'Unknown Author', narrator: null, cachedLibraryCoverPath: null }), 'audiobook');
    expect(shown).toMatchObject({ title: 'Requested Title', author: 'Requested Author', narrator: 'Requested Reader', coverArtUrl: BOOK.coverArtUrl, libraryAsin: 'B0LIBRARY2' });
  });

  it.each([
    ['no library ASIN', { ...BOOK, libraryAsin: null }, rows(), 'audiobook'],
    ['no linked row (item gone)', BOOK, new Map(), 'audiobook'],
    ['not linked (absItemId cleared)', { ...BOOK, absItemId: null }, rows(), 'audiobook'],
    ['an ebook request of the book', BOOK, rows(), 'ebook'],
  ])('%s: shown as stored, effective libraryAsin null', (_label, book, linked, type) => {
    expect(withLibraryDisplay(book, linked as never, type)).toEqual({ ...book, libraryAsin: null });
  });

  it('a request without a type is an audiobook request', () => {
    expect(withLibraryDisplay(BOOK, rows(), null).title).toBe('Library Title');
  });
});

describe('loadLinkedRows / withLibraryDisplayAll', () => {
  beforeEach(() => vi.clearAllMocks());

  it('no followed book: no query', async () => {
    expect((await loadLinkedRows([{ ...BOOK, libraryAsin: null }, null])).size).toBe(0);
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
  });

  it('one query for the followed books of the page', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValue([ROW]);
    const out = await withLibraryDisplayAll([
      { id: 'r1', type: 'audiobook', audiobook: BOOK },
      { id: 'r2', type: 'audiobook', audiobook: { ...BOOK, id: 'ab-2', absItemId: 'abs-2', libraryAsin: null } },
      { id: 'r3', type: 'audiobook', audiobook: null },
    ]);
    expect(prismaMock.plexLibrary.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.plexLibrary.findMany.mock.calls[0][0].where).toEqual({ plexGuid: { in: ['abs-1'] } });
    expect(out.map((r) => r.audiobook?.title ?? null)).toEqual(['Library Title', 'Requested Title', null]);
    expect(out[1].audiobook?.libraryAsin).toBeNull();
  });
});

describe('libraryCoverUrl', () => {
  it('serves the cached file name through the library cache route', () => {
    expect(libraryCoverUrl('/app/cache/library/abc.jpg')).toBe('/api/cache/library/abc.jpg');
    expect(libraryCoverUrl(null)).toBeNull();
    expect(libraryCoverUrl('')).toBeNull();
  });
});
