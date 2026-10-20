/**
 * Component: Library Delete Guard Tests (real filesystem)
 * Documentation: documentation/admin-features/request-deletion.md
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { generateFilesHash } from '@/lib/utils/files-hash';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

const { assertSafeLibraryDelete, isStaleStoredFolder, planEbookDelete } = await import('@/lib/utils/library-delete-guard');

let root: string;
let media: string;
let downloads: string;
let otherBooks: Array<{ id: string; title: string; filePath: string | null }>;

function write(file: string, content = 'x') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** A title folder as an import leaves it: audio files plus cover, with the book's filesHash. */
function titleFolder(rel: string, audio = ['Book.m4b']) {
  const dir = path.join(media, rel);
  for (const name of audio) write(path.join(dir, name));
  write(path.join(dir, 'cover.jpg'));
  return { dir, book: { id: 'book-1', filePath: dir, filesHash: generateFilesHash(audio) } };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(() => null, (e: Error & { reason?: string }) => e);
  expect(error, 'expected a refusal').not.toBeNull();
  expect(error!.name).toBe('UnsafeDeleteError');
  return error!.reason ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-library-guard-')));
  media = path.join(root, 'media');
  downloads = path.join(root, 'downloads');
  fs.mkdirSync(media, { recursive: true });
  fs.mkdirSync(downloads, { recursive: true });
  otherBooks = [];
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
    if (where.key === 'media_dir') return { key: 'media_dir', value: media, encrypted: false };
    if (where.key === 'download_dir') return { key: 'download_dir', value: downloads, encrypted: false };
    return null;
  });
  prismaMock.audiobook.findMany.mockImplementation(async () => otherBooks);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('assertSafeLibraryDelete', () => {
  it('allows a title folder whose direct audio matches filesHash', async () => {
    const { dir, book } = titleFolder('Author/Book B0TEST0001', ['01.mp3', '02.mp3']);
    const safe = await assertSafeLibraryDelete(dir, book);
    expect(safe.exists).toBe(true);
    expect(safe.deletePath).toBe(safe.canonicalPath);
    expect(path.resolve(safe.canonicalPath)).toBe(path.resolve(dir));
  });

  it('allows a default-template folder that also holds the ebook (row overwritten by the ebook import)', async () => {
    const { dir, book } = titleFolder('Author/Book');
    write(path.join(dir, 'Book.epub'));
    await expect(assertSafeLibraryDelete(dir, book)).resolves.toMatchObject({ exists: true });
  });

  it('refuses the media root, and anything outside it', async () => {
    const book = { id: 'b', filePath: media, filesHash: generateFilesHash([]) };
    expect(await refusal(assertSafeLibraryDelete(media, book))).toBe('it is the media library root');
    const outside = path.join(root, 'elsewhere', 'Book');
    write(path.join(outside, 'Book.m4b'));
    expect(await refusal(assertSafeLibraryDelete(outside, { ...book, filePath: outside }))).toContain('outside the media library');
  });

  it('refuses a folder that is or contains a configured root', async () => {
    const nested = path.join(media, 'incoming');
    fs.mkdirSync(nested, { recursive: true });
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === 'media_dir') return { value: media };
      if (where.key === 'download_dir') return { value: nested };
      return null;
    });
    expect(await refusal(assertSafeLibraryDelete(nested, { id: 'b', filePath: nested, filesHash: null }))).toContain('configured root');
    const inner = path.join(nested, 'Book');
    write(path.join(inner, 'Book.m4b'));
    // A folder holding the download root itself
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === 'media_dir') return { value: media };
      if (where.key === 'download_dir') return { value: inner };
      return null;
    });
    expect(await refusal(assertSafeLibraryDelete(nested, { id: 'b', filePath: nested, filesHash: null }))).toContain('contains a configured root');
  });

  it('refuses an {author} folder holding another book, and a folder another book also points at', async () => {
    const authorDir = path.join(media, 'Author');
    write(path.join(authorDir, 'A.epub'));
    write(path.join(authorDir, 'Other Book', 'Other.m4b'));
    otherBooks = [{ id: 'book-2', title: 'Other Book', filePath: path.join(authorDir, 'Other Book') }];
    const book = { id: 'book-1', filePath: authorDir, filesHash: generateFilesHash([]) };
    expect(await refusal(assertSafeLibraryDelete(authorDir, book))).toBe('it contains the folder of "Other Book"');

    otherBooks = [{ id: 'book-2', title: 'Other Book', filePath: authorDir }];
    expect(await refusal(assertSafeLibraryDelete(authorDir, book))).toBe('it is also the folder of "Other Book"');
  });

  it('skips other rows whose folder no longer exists, and compares rows canonically', async () => {
    const { dir, book } = titleFolder('Author/Book');
    otherBooks = [{ id: 'gone', title: 'Gone', filePath: path.join(dir, 'missing') }];
    await expect(assertSafeLibraryDelete(dir, book)).resolves.toMatchObject({ exists: true });

    // The same folder spelled through a symlink is still the same folder
    const alias = path.join(root, 'alias');
    fs.symlinkSync(media, alias, 'junction');
    otherBooks = [{ id: 'book-2', title: 'Alias', filePath: path.join(alias, 'Author', 'Book') }];
    expect(await refusal(assertSafeLibraryDelete(dir, book))).toBe('it is also the folder of "Alias"');
  });

  it('refuses when the folder contents changed since import (foreign audio added)', async () => {
    const { dir, book } = titleFolder('Author/Book');
    write(path.join(dir, 'Bonus Track.mp3'));
    expect(await refusal(assertSafeLibraryDelete(dir, book))).toBe('folder contents changed since import');
  });

  it('refuses with no filesHash (an import where nothing was ours) and with audio in a subfolder', async () => {
    const { dir, book } = titleFolder('Author/Book');
    expect(await refusal(assertSafeLibraryDelete(dir, { ...book, filesHash: null }))).toContain('no import record');
    write(path.join(dir, 'Disc 2', 'Track.mp3'));
    expect(await refusal(assertSafeLibraryDelete(dir, book))).toBe('it has audio files in a subfolder');
  });

  it('refuses a symlinked title folder that points outside the library; the target stays', async () => {
    const seeding = path.join(downloads, 'Book [seeding]');
    write(path.join(seeding, 'Book.m4b'));
    const link = path.join(media, 'Author', 'Book');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(seeding, link, 'junction');
    const book = { id: 'book-1', filePath: link, filesHash: generateFilesHash(['Book.m4b']) };
    expect(await refusal(assertSafeLibraryDelete(link, book))).toContain('outside the media library');
    expect(fs.existsSync(path.join(seeding, 'Book.m4b'))).toBe(true);
  });

  it('returns the link itself for a symlinked folder inside the library', async () => {
    const real = titleFolder('Store/Book');
    const link = path.join(media, 'Author', 'Book');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(real.dir, link, 'junction');
    const safe = await assertSafeLibraryDelete(link, { ...real.book, filePath: link });
    expect(path.resolve(safe.deletePath)).toBe(path.resolve(link));
    expect(path.resolve(safe.canonicalPath)).toBe(path.resolve(real.dir));
  });

  it('reports a missing folder as already gone when the library looks mounted, after the location rules', async () => {
    const other = titleFolder('Other/Book');
    otherBooks = [{ id: 'book-2', title: 'Other', filePath: other.dir }];
    const missing = path.join(media, 'Author', 'Gone');
    await expect(assertSafeLibraryDelete(missing, { id: 'b', filePath: missing, filesHash: 'h' })).resolves.toMatchObject({ exists: false });
    expect(await refusal(assertSafeLibraryDelete(path.join(root, 'nope'), { id: 'b', filePath: 'x', filesHash: 'h' }))).toContain('outside');
  });

  it('refuses a missing folder when the media library is empty (an unmounted volume)', async () => {
    const missing = path.join(media, 'Author', 'Gone');
    const reason = await refusal(assertSafeLibraryDelete(missing, { id: 'b', filePath: missing, filesHash: 'h' }));
    expect(reason).toContain('the folder is missing and the media library');
    expect(reason).toContain('is the media volume mounted?');
  });

  it('refuses a missing folder when no other stored book folder exists either', async () => {
    write(path.join(media, '.placeholder'));
    otherBooks = [{ id: 'book-2', title: 'Other', filePath: path.join(media, 'Other', 'Gone too') }];
    const missing = path.join(media, 'Author', 'Gone');
    expect(await refusal(assertSafeLibraryDelete(missing, { id: 'b', filePath: missing, filesHash: 'h' }))).toContain('no stored book folder exists');
  });

  it('refuses a file, an empty path, and fails closed when the roots cannot be read', async () => {
    const file = path.join(media, 'Author', 'Book.m4b');
    write(file);
    expect(await refusal(assertSafeLibraryDelete(file, { id: 'b', filePath: file, filesHash: null }))).toBe('it is not a folder');
    expect(await refusal(assertSafeLibraryDelete('', { id: 'b', filePath: '', filesHash: null }))).toBe('there is no stored folder');
    prismaMock.configuration.findUnique.mockRejectedValue(new Error('db down'));
    const { dir, book } = titleFolder('Author/Book');
    expect(await refusal(assertSafeLibraryDelete(dir, book))).toContain('nothing deleted: db down');
  });
});

describe('planEbookDelete', () => {
  it('returns every ebook directly in a folder that passes the evidence rule', async () => {
    const { dir, book } = titleFolder('Author/Book');
    write(path.join(dir, 'Book.epub'));
    write(path.join(dir, 'Book.pdf'));
    const files = await planEbookDelete(dir, book);
    expect(files.map((f) => path.basename(f)).sort()).toEqual(['Book.epub', 'Book.pdf']);
  });

  it('returns the only ebook in a folder without audio evidence (ebook-only book)', async () => {
    const dir = path.join(media, 'Ebooks');
    write(path.join(dir, 'Mine.epub'));
    const files = await planEbookDelete(dir, { id: 'b', filePath: dir, filesHash: null });
    expect(files.map((f) => path.basename(f))).toEqual(['Mine.epub']);
  });

  it('refuses a flat folder with several ebooks that is not provably this book\'s', async () => {
    const dir = path.join(media, 'Ebooks');
    write(path.join(dir, 'Mine.epub'));
    write(path.join(dir, 'Calibre Book.epub'));
    const reason = await refusal(planEbookDelete(dir, { id: 'b', filePath: dir, filesHash: null }));
    expect(reason).toContain('holds 2 ebook files');
    expect(fs.existsSync(path.join(dir, 'Calibre Book.epub'))).toBe(true);
  });

  it('refuses a folder shared with another book (rule c), even with one ebook', async () => {
    const dir = path.join(media, 'Ebooks');
    write(path.join(dir, 'Mine.epub'));
    otherBooks = [{ id: 'book-2', title: 'Second', filePath: dir }];
    expect(await refusal(planEbookDelete(dir, { id: 'b', filePath: dir, filesHash: null }))).toBe('it is also the folder of "Second"');
  });

  it('returns nothing for a missing folder (library mounted)', async () => {
    write(path.join(media, 'Other', 'x.epub'));
    const dir = path.join(media, 'Author', 'Gone');
    await expect(planEbookDelete(dir, { id: 'b', filePath: dir, filesHash: null })).resolves.toEqual([]);
  });
});

describe('isStaleStoredFolder', () => {
  it('is true only for a folder that is gone AND outside the current media_dir (library moved)', async () => {
    expect(await isStaleStoredFolder(path.join(root, 'old-library', 'Author', 'Book'))).toBe(true);
    expect(await isStaleStoredFolder(path.join(media, 'Author', 'Gone'))).toBe(false);
    const outsideButThere = path.join(root, 'elsewhere', 'Book');
    write(path.join(outsideButThere, 'Book.m4b'));
    expect(await isStaleStoredFolder(outsideButThere)).toBe(false);
    expect(await isStaleStoredFolder(null)).toBe(false);
  });

  it('is false when the roots cannot be read (fail closed)', async () => {
    prismaMock.configuration.findUnique.mockRejectedValue(new Error('db down'));
    expect(await isStaleStoredFolder(path.join(root, 'old-library', 'Author', 'Book'))).toBe(false);
  });
});
