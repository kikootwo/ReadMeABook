/**
 * Component: Audiobook Request Delete Tests: only what that request placed (#526, real filesystem)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * deleteRequest for audiobook requests with real temp folders: the audio goes,
 * the cover and junk only when nothing else is left, the folder only when empty.
 * A delivered ebook request of the same book stays, unlinked, and the book keeps
 * its ebook's folder; deleting both requests, in either order, leaves no folder.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { book, ebookRequest, entryFor, imported, makeLibrary, snapshot, write, type Library } from './request-delete-ebook-fixture';

const prismaMock = createPrismaMock();
const configServiceMock = { get: vi.fn(), getBackendMode: vi.fn() };
const absMock = vi.hoisted(() => ({ getABSItem: vi.fn(), deleteABSItem: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/audiobookshelf/api', () => absMock);

const { deleteRequest } = await import('@/lib/services/request-delete.service');

const NO_RECORD = 'RMAB has no record that it placed it';
const OTHER_EBOOK = 'ebook of another request';

let lib: Library;
/** Active ebook requests: the D1 label lookup, the child lookup (OR) and D2's other-records lookup. */
let ebookRows: Array<{ id: string; type: string; status: string; completedAt: Date | null; placedEbookFiles: unknown; parentRequestId: string | null }>;

function audiobookRequest(audiobook: ReturnType<typeof book>) {
  prismaMock.request.findFirst.mockResolvedValue({ id: 'req-1', type: 'audiobook', audiobook, downloadHistory: [] });
}

function audioBook(dir: string, overrides: Record<string, unknown> = {}) {
  return book(dir, { fileFormat: 'm4b', ...overrides });
}

/** A delivered ebook request of the book whose record holds `file`. */
function deliveredEbook(file: string, id = 'ebook-1') {
  const row = { id, type: 'ebook', status: 'downloaded', completedAt: new Date(), placedEbookFiles: [entryFor(file)], parentRequestId: 'req-1' };
  ebookRows.push(row);
  return row;
}

function bookUpdate() {
  return prismaMock.audiobook.update.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  lib = makeLibrary('rmab-526-delete-');
  ebookRows = [];
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
    if (where.key === 'media_dir') return { value: lib.media };
    if (where.key === 'download_dir') return { value: lib.downloads };
    return null;
  });
  prismaMock.audiobook.findMany.mockResolvedValue([]);
  prismaMock.request.findMany.mockImplementation(async ({ where }: { where: { id?: { not: string } } }) =>
    ebookRows.filter((r) => !where?.id || r.id !== where.id.not)
  );
  prismaMock.plexLibrary.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.plexLibrary.findMany.mockResolvedValue([]);
  configServiceMock.getBackendMode.mockResolvedValue('audiobookshelf');
  configServiceMock.get.mockResolvedValue(null);
  absMock.getABSItem.mockResolvedValue(null);
  absMock.deleteABSItem.mockResolvedValue(undefined);
});

afterEach(() => {
  fs.rmSync(lib.root, { recursive: true, force: true });
});

describe('deleteRequest (audiobook, #526): what leaves the book folder', () => {
  it('audio + cover + the ebook request\'s recorded epub: audio and cover go, the epub and folder stay; the ebook request stays', async () => {
    const dir = imported(lib.media, 'Author/Book');
    const epub = write(path.join(dir, 'Book.epub'), 'epub bytes');
    deliveredEbook(epub);
    audiobookRequest(audioBook(dir));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(fs.readdirSync(dir)).toEqual(['Book.epub']);
    expect(fs.readFileSync(epub, 'utf8')).toBe('epub bytes');
    expect(result).toMatchObject({ success: true, filesDeleted: true, folderKept: { files: [{ name: 'Book.epub', why: OTHER_EBOOK }], more: 0 } });
    expect(path.resolve(result.folderKept!.folder)).toBe(dir);
    expect(result.filesKeptReason).toBeUndefined();
    expect(result.message).toBe(`Request deleted; the book folder stays because it still holds: Book.epub (${OTHER_EBOOK})`);
    // The ebook request stays, unlinked; the book keeps the ebook's folder and format (an ebook import's state)
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['ebook-1'] } }, data: { parentRequestId: null } });
    expect(prismaMock.request.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }));
    expect(bookUpdate()).toEqual({
      where: { id: 'book-1' },
      data: expect.objectContaining({ status: 'requested', absItemId: null, filePath: dir, fileFormat: 'epub', filesHash: null }),
    });
  });

  it('a user file beside it: the cover stays too, both listed', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['notes.txt']);
    const epub = write(path.join(dir, 'Book.epub'), 'epub bytes');
    deliveredEbook(epub);
    audiobookRequest(audioBook(dir));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(fs.readdirSync(dir).sort()).toEqual(['Book.epub', 'cover.jpg', 'notes.txt']);
    expect(result.folderKept?.files).toEqual([
      { name: 'Book.epub', why: OTHER_EBOOK },
      { name: 'cover.jpg', why: NO_RECORD },
      { name: 'notes.txt', why: NO_RECORD },
    ]);
  });

  it('audio + cover + junk (.DS_Store, @eaDir/x): the whole folder goes, empty parents swept', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['.DS_Store', '._Book.m4b.meta', 'metadata.json']);
    write(path.join(dir, '@eaDir', 'Book.m4b', 'SYNOFILE_THUMB_M.jpg'));
    audiobookRequest(audioBook(dir));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result).toMatchObject({ filesDeleted: true, message: 'Request deleted successfully' });
    expect(result.folderKept).toBeUndefined();
    expect(fs.existsSync(path.join(lib.media, 'Author'))).toBe(false);
    expect(bookUpdate().data).toMatchObject({ filePath: null, fileFormat: null, filesHash: null });
  });

  it('@eaDir holding a link: kept whole (the link target untouched), the cover stays with it', async () => {
    const dir = imported(lib.media, 'Author/Book');
    const outside = write(path.join(lib.root, 'outside', 'keep.txt'), 'keep');
    fs.mkdirSync(path.join(dir, '@eaDir'));
    fs.symlinkSync(path.dirname(outside), path.join(dir, '@eaDir', 'link'), 'junction');
    audiobookRequest(audioBook(dir));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(fs.existsSync(path.join(dir, 'Book.m4b'))).toBe(false);
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
    expect(fs.lstatSync(path.join(dir, '@eaDir', 'link')).isSymbolicLink()).toBe(true);
    expect(result.folderKept?.files).toEqual([
      { name: '@eaDir/', why: `${NO_RECORD} (it holds a link)` },
      { name: 'cover.jpg', why: NO_RECORD },
    ]);
  });

  it('a legacy ebook (no placement record) stays with the no-record reason; the cover stays with it', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.epub']);
    ebookRows.push({ id: 'ebook-1', type: 'ebook', status: 'downloaded', completedAt: new Date(), placedEbookFiles: null, parentRequestId: 'req-1' });
    audiobookRequest(audioBook(dir));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(fs.readdirSync(dir).sort()).toEqual(['Book.epub', 'cover.jpg']);
    expect(result.folderKept?.files).toEqual([{ name: 'Book.epub', why: NO_RECORD }, { name: 'cover.jpg', why: NO_RECORD }]);
    // Delivered, so it stays; its file has no record, so the book row is cleared as before
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['ebook-1'] } }, data: { parentRequestId: null } });
    expect(bookUpdate().data).toMatchObject({ filePath: null, fileFormat: null });
  });

  it('a subfolder is never entered: it stays and is listed', async () => {
    const dir = imported(lib.media, 'Author/Book');
    write(path.join(dir, 'extras', 'map.pdf'), 'pdf');
    audiobookRequest(audioBook(dir));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(fs.readFileSync(path.join(dir, 'extras', 'map.pdf'), 'utf8')).toBe('pdf');
    expect(result.folderKept?.files).toEqual([{ name: 'cover.jpg', why: NO_RECORD }, { name: 'extras/', why: NO_RECORD }]);
  });

  it('a stale partial copy goes, a fresh one stays (an import is still writing it)', async () => {
    const dir = imported(lib.media, 'Author/Book');
    const stale = write(path.join(dir, '.rmab-partial-0123456789ab-deadbeef.part'));
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    audiobookRequest(audioBook(dir));
    expect((await deleteRequest('req-1', 'admin-1')).folderKept).toBeUndefined();
    expect(fs.existsSync(dir)).toBe(false);

    const again = imported(lib.media, 'Author/Book');
    write(path.join(again, '.rmab-partial-0123456789ab-feedface.part'));
    audiobookRequest(audioBook(again));
    expect((await deleteRequest('req-1', 'admin-1')).folderKept?.files).toEqual([
      { name: '.rmab-partial-0123456789ab-feedface.part', why: 'an import is still writing it' },
      { name: 'cover.jpg', why: NO_RECORD },
    ]);
  });

  it('a title folder that is a link inside the library: only the link goes, nothing in its target', async () => {
    const target = imported(lib.media, 'Real/Book', ['Book.m4b'], ['Book.epub']);
    const before = snapshot(target);
    const link = path.join(lib.media, 'Author', 'Book');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, 'junction');
    audiobookRequest(audioBook(link));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(true);
    expect(fs.existsSync(link)).toBe(false);
    expect(snapshot(target)).toEqual(before);
  });

  it('an undelivered ebook child is still soft-deleted with the audiobook request', async () => {
    const dir = imported(lib.media, 'Author/Book');
    ebookRows.push({ id: 'ebook-2', type: 'ebook', status: 'searching', completedAt: null, placedEbookFiles: null, parentRequestId: 'req-1' });
    audiobookRequest(audioBook(dir));

    await deleteRequest('req-1', 'admin-1');

    expect(prismaMock.request.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ebook-2'] } },
      data: expect.objectContaining({ deletedBy: 'admin-1' }),
    });
  });
});

describe('deleteRequest (#526): both requests deleted, in either order, leave no folder', () => {
  function setUp() {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['.DS_Store']);
    const epub = write(path.join(dir, 'Book.epub'), 'epub bytes');
    const ebook = deliveredEbook(epub);
    const rest = write(path.join(lib.media, 'Other', 'Other.m4b'), 'other');
    return { dir, epub, ebook, rest };
  }

  it('audiobook request first, then the ebook request: the folder is gone and the book points at nothing', async () => {
    const { dir, ebook, rest } = setUp();
    audiobookRequest(audioBook(dir));
    await deleteRequest('req-1', 'admin-1');
    expect(fs.readdirSync(dir)).toEqual(['Book.epub']); // junk goes with the cover: nothing of anyone else's is left
    write(path.join(dir, 'Thumbs.db')); // junk that appears later goes with the ebook delete
    const survivorBook = audioBook(dir, { filesHash: null, fileFormat: 'epub', absItemId: null });
    expect(bookUpdate().data).toMatchObject({ filePath: dir, fileFormat: 'epub' });

    prismaMock.audiobook.update.mockClear();
    prismaMock.request.findFirst.mockResolvedValue({ ...ebookRequest(survivorBook, { placedEbookFiles: ebook.placedEbookFiles }), id: 'ebook-1' });
    const result = await deleteRequest('ebook-1', 'admin-1');

    expect(result).toMatchObject({ filesDeleted: true, message: 'Request deleted successfully' });
    expect(fs.existsSync(path.join(lib.media, 'Author'))).toBe(false);
    expect(fs.readFileSync(rest, 'utf8')).toBe('other');
    expect(bookUpdate()).toEqual({ where: { id: 'book-1' }, data: expect.objectContaining({ filePath: null, fileFormat: null }) });
  });

  it('ebook request first, then the audiobook request: the folder is gone', async () => {
    const { dir, ebook, rest } = setUp();
    prismaMock.request.findFirst.mockResolvedValue({ ...ebookRequest(audioBook(dir), { placedEbookFiles: ebook.placedEbookFiles }), id: 'ebook-1' });
    await deleteRequest('ebook-1', 'admin-1');
    expect(fs.readdirSync(dir).sort()).toEqual(['.DS_Store', 'Book.m4b', 'cover.jpg']);
    expect(prismaMock.audiobook.update).not.toHaveBeenCalled();

    ebookRows = []; // soft-deleted
    audiobookRequest(audioBook(dir));
    const result = await deleteRequest('req-1', 'admin-1');

    expect(result).toMatchObject({ filesDeleted: true, message: 'Request deleted successfully' });
    expect(fs.existsSync(path.join(lib.media, 'Author'))).toBe(false);
    expect(fs.readFileSync(rest, 'utf8')).toBe('other');
  });

  it('a book imported before #497 (legacy ebook, no record): audiobook then ebook request leaves the epub and cover, listed', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.epub']);
    ebookRows.push({ id: 'ebook-1', type: 'ebook', status: 'downloaded', completedAt: new Date(), placedEbookFiles: null, parentRequestId: 'req-1' });
    audiobookRequest(audioBook(dir));
    await deleteRequest('req-1', 'admin-1');

    prismaMock.request.findFirst.mockResolvedValue({ ...ebookRequest(audioBook(null), { placedEbookFiles: null }), id: 'ebook-1' });
    const result = await deleteRequest('ebook-1', 'admin-1');

    // No record of the ebook: nothing of it is removed (the safe side), and it says so
    expect(result.filesKeptReason).toContain('RMAB has no record of the ebook files this request placed');
    expect(fs.readdirSync(dir).sort()).toEqual(['Book.epub', 'cover.jpg']);
  });
});
