/**
 * Component: Ebook On Disk Check Tests (#313)
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { findEbookOnDisk } from '@/lib/utils/ebook-on-disk';

/** Audiobook rows the "other book in this folder" lookup reads (filtered like the real query). */
const db = vi.hoisted(() => ({ books: [] as Array<{ id: string; filePath: string | null }> }));
const prismaMock = vi.hoisted(() => ({ audiobook: { findMany: vi.fn() } }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const BOOK_ID = 'book-1';
let root: string;

async function bookFolder(files: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(root, 'book-'));
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), 'x');
  }
  return dir;
}

function debugLogger() {
  return { debug: vi.fn() } as unknown as Parameters<typeof findEbookOnDisk>[2] & { debug: ReturnType<typeof vi.fn> };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-313-'));
  db.books = [];
  prismaMock.audiobook.findMany.mockReset();
  prismaMock.audiobook.findMany.mockImplementation(async (args: { where?: { id?: { not?: string } } }) =>
    db.books.filter((book) => book.filePath !== null && book.id !== args?.where?.id?.not)
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('findEbookOnDisk', () => {
  it.each([
    ['an epub', ['01.mp3', '02.mp3', 'Book.epub'], 'Book.epub'],
    ['an azw3', ['01.mp3', 'Book.azw3'], 'Book.azw3'],
    ['an upper-case extension', ['Book.m4b', 'Book.EPUB'], 'Book.EPUB'],
  ])('finds %s next to the audio', async (_label, files, expected) => {
    const dir = await bookFolder(files);
    expect(await findEbookOnDisk(dir, BOOK_ID)).toBe(expected);
  });

  it('prefers the organizer order when several ebook formats are present', async () => {
    const dir = await bookFolder(['Book.pdf', 'Book.epub', 'Book.mp3']);
    expect(await findEbookOnDisk(dir, BOOK_ID)).toBe('Book.epub');
  });

  it.each([
    ['an empty folder', []],
    ['a folder with only audio and a cover', ['01.mp3', '02.mp3', 'cover.jpg']],
    ['an ebook only inside a subfolder (no recursion)', ['01.mp3', 'Other Book/Other.epub']],
    ['a macOS resource-fork sidecar', ['01.mp3', '._Book.epub']],
  ])('answers no for %s', async (_label, files) => {
    const dir = await bookFolder(files);
    expect(await findEbookOnDisk(dir, BOOK_ID)).toBeNull();
  });

  it('answers no for a folder named like an ebook', async () => {
    const dir = await bookFolder(['01.mp3']);
    await fs.mkdir(path.join(dir, 'Extras.epub'));
    expect(await findEbookOnDisk(dir, BOOK_ID)).toBeNull();
  });

  it('answers no and logs once at debug for a missing folder', async () => {
    const logger = debugLogger();
    expect(await findEbookOnDisk(path.join(root, 'gone'), BOOK_ID, logger)).toBeNull();
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('answers no and logs once at debug when the stored path is a file', async () => {
    const dir = await bookFolder(['Book.m4b']);
    const logger = debugLogger();
    expect(await findEbookOnDisk(path.join(dir, 'Book.m4b'), BOOK_ID, logger)).toBeNull();
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it.each([null, undefined, ''])('answers no without touching the disk for path %j', async (value) => {
    const logger = debugLogger();
    expect(await findEbookOnDisk(value, BOOK_ID, logger)).toBeNull();
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('never changes the folder', async () => {
    const dir = await bookFolder(['01.mp3', 'Book.epub']);
    await findEbookOnDisk(dir, BOOK_ID);
    expect((await fs.readdir(dir)).sort()).toEqual(['01.mp3', 'Book.epub']);
  });
});

describe('findEbookOnDisk and a PDF (audiobooks often ship a PDF booklet)', () => {
  it('answers no when a PDF is the only ebook-type file', async () => {
    const dir = await bookFolder(['01.mp3', 'Companion Booklet.pdf', 'cover.jpg']);
    expect(await findEbookOnDisk(dir, BOOK_ID)).toBeNull();
  });

  it.each([
    ['an epub', ['01.mp3', 'Booklet.pdf', 'Book.epub'], 'Book.epub'],
    ['a mobi', ['01.mp3', 'Booklet.pdf', 'Book.mobi'], 'Book.mobi'],
  ])('finds %s with a PDF beside it', async (_label, files, expected) => {
    const dir = await bookFolder(files);
    expect(await findEbookOnDisk(dir, BOOK_ID)).toBe(expected);
  });
});

describe('findEbookOnDisk in a folder another book also stores', () => {
  it('answers no when another book row stores the same folder', async () => {
    const dir = await bookFolder(['A - 01.mp3', 'A.epub', 'B - 01.mp3']);
    db.books = [{ id: 'book-A', filePath: dir }, { id: BOOK_ID, filePath: dir }];
    const logger = debugLogger();

    expect(await findEbookOnDisk(dir, BOOK_ID, logger)).toBeNull();
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('answers no when the other row spells the same folder differently (trailing slash)', async () => {
    const dir = await bookFolder(['A - 01.mp3', 'A.epub', 'B - 01.mp3']);
    db.books = [{ id: 'book-A', filePath: `${dir}${path.sep}` }];
    expect(await findEbookOnDisk(dir, BOOK_ID)).toBeNull();
  });

  it('answers no when the other row reaches the same folder through a link', async () => {
    const dir = await bookFolder(['A - 01.mp3', 'A.epub', 'B - 01.mp3']);
    const link = path.join(root, 'link-to-book');
    await fs.symlink(dir, link, 'junction');
    db.books = [{ id: 'book-A', filePath: link }];
    expect(await findEbookOnDisk(dir, BOOK_ID)).toBeNull();
  });

  it('still finds the ebook when only this book stores the folder', async () => {
    const dir = await bookFolder(['01.mp3', 'Book.epub']);
    const elsewhere = await bookFolder(['01.mp3']);
    db.books = [
      { id: BOOK_ID, filePath: dir },
      { id: 'book-2', filePath: elsewhere },
      { id: 'book-3', filePath: path.join(dir, 'Subfolder') },
      { id: 'book-4', filePath: null },
    ];
    expect(await findEbookOnDisk(dir, BOOK_ID)).toBe('Book.epub');
  });

  it('reads other books only when an ebook is found', async () => {
    const dir = await bookFolder(['01.mp3', 'cover.jpg']);
    expect(await findEbookOnDisk(dir, BOOK_ID)).toBeNull();
    expect(prismaMock.audiobook.findMany).not.toHaveBeenCalled();
  });

  it('answers no and logs once at debug when the other-books lookup fails', async () => {
    const dir = await bookFolder(['01.mp3', 'Book.epub']);
    prismaMock.audiobook.findMany.mockRejectedValueOnce(new Error('db down'));
    const logger = debugLogger();

    expect(await findEbookOnDisk(dir, BOOK_ID, logger)).toBeNull();
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });
});
