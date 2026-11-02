/**
 * Component: Ebook Request Delete Tests: only the file that request placed (#497, real filesystem)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * deleteRequest for ebook requests with real temp folders. The request's own
 * placement record (Request.placedEbookFiles) decides what goes, not its status
 * and not what else sits in the book folder. Reached only through deleteRequest.
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

const NO_RECORD_WHY = 'it was imported before RMAB kept one, or the record could not be saved';
const LEGACY = `RMAB has no record of the ebook files this request placed (${NO_RECORD_WHY}), so no ebook file was removed`;
const EARLIER = `an earlier import of this request has no record (${NO_RECORD_WHY}), so its ebook file was not removed`;
const ALREADY_THERE = 'RMAB has no record that this request placed the ebook (its import found it already in the library), so it was not removed';
const MARKER = { earlierImport: 'unrecorded' };

let lib: Library;
let otherBooks: Array<{ id: string; title: string; filePath: string | null }>;
/** Other active requests' placement records (the step 2 lookup). */
let otherRecords: Array<{ placedEbookFiles: unknown }>;

function load(req: ReturnType<typeof ebookRequest>) {
  prismaMock.request.findFirst.mockResolvedValue(req);
}

/** No backend delete, no record cleanup, no book row change; the request is soft-deleted. */
function expectLibraryRowsUntouched() {
  expect(absMock.deleteABSItem).not.toHaveBeenCalled();
  expect(prismaMock.plexLibrary.deleteMany).not.toHaveBeenCalled();
  expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
  expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deletedBy: 'admin-1' }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  lib = makeLibrary('rmab-497-delete-');
  otherBooks = [];
  otherRecords = [];
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
    if (where.key === 'media_dir') return { value: lib.media };
    if (where.key === 'download_dir') return { value: lib.downloads };
    return null;
  });
  prismaMock.audiobook.findMany.mockImplementation(async () => otherBooks);
  prismaMock.request.findMany.mockImplementation(async () => otherRecords);
  configServiceMock.getBackendMode.mockResolvedValue('audiobookshelf');
  configServiceMock.get.mockResolvedValue(null);
});

afterEach(() => {
  fs.rmSync(lib.root, { recursive: true, force: true });
});

describe('#497: an ebook request delete removes only the ebook file that request placed', () => {
  it('issue steps: imported audiobook + the user\'s own Book.epub + a failed ebook request: the epub stays, no reason', async () => {
    const dir = imported(lib.media, 'Author/Book B0TEST0001', ['Book.m4b'], ['Book.epub']);
    const before = snapshot(lib.media);
    load(ebookRequest(book(dir), { status: 'failed', completedAt: null }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result).toMatchObject({ success: true, filesDeleted: false, message: 'Request deleted successfully' });
    expect(result.filesKeptReason).toBeUndefined();
    expect(snapshot(lib.media)).toEqual(before);
    expectLibraryRowsUntouched();
  });

  it.each([
    'pending', 'awaiting_approval', 'denied', 'searching', 'downloading', 'processing',
    'awaiting_search', 'awaiting_release', 'awaiting_import', 'failed', 'warn', 'cancelled', 'available',
  ])('a %s ebook request with no record deletes no file (the only ebook in the folder stays)', async (status) => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.epub']);
    const before = snapshot(lib.media);
    load(ebookRequest(book(dir), { status, completedAt: null }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.success).toBe(true);
    expect(result.filesDeleted).toBe(false);
    expect(result.filesKeptReason).toBeUndefined();
    expect(snapshot(lib.media)).toEqual(before);
  });

  it('a pre-upgrade delivered request (no record, NULL) keeps the ebook and says it was imported before RMAB kept records', async () => {
    const dir = path.join(lib.media, 'Ebooks');
    write(path.join(dir, 'Book.epub'));
    load(ebookRequest(book(dir, { filesHash: null }), { status: 'downloaded', placedEbookFiles: null }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(false);
    expect(result.filesKeptReason).toBe(LEGACY);
    expect(result.message).toBe(`Request deleted; files kept: ${LEGACY}`);
    expect(fs.existsSync(path.join(dir, 'Book.epub'))).toBe(true);
    expectLibraryRowsUntouched();
  });

  it('a request recycled after delivery (completedAt set, now failed) with no record also gets the pre-upgrade reason', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.epub']);
    load(ebookRequest(book(dir), { status: 'failed', placedEbookFiles: null }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe(LEGACY);
    expect(fs.existsSync(path.join(dir, 'Book.epub'))).toBe(true);
  });

  it('a delivered request whose import placed nothing ([]: the ebook was already there) keeps it and says so', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.epub']);
    const before = snapshot(lib.media);
    load(ebookRequest(book(dir), { status: 'downloaded', placedEbookFiles: [] }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(false);
    expect(result.filesKeptReason).toBe(ALREADY_THERE);
    expect(snapshot(lib.media)).toEqual(before);
  });

  it('removes the recorded epub; the user\'s azw3, the audio and the cover stay; no backend or row changes', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.epub', 'Book.azw3']);
    load(ebookRequest(book(dir), { placedEbookFiles: [entryFor(path.join(dir, 'Book.epub'))] }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result).toMatchObject({ success: true, filesDeleted: true, message: 'Request deleted successfully' });
    expect(result.filesKeptReason).toBeUndefined();
    expect(fs.readdirSync(dir).sort()).toEqual(['Book.azw3', 'Book.m4b', 'cover.jpg']);
    expectLibraryRowsUntouched();
  });

  it('a flat folder with the recorded ebook and foreign ebooks: only the recorded one goes', async () => {
    const dir = path.join(lib.media, 'Ebooks');
    write(path.join(dir, 'Book.epub'), 'rmab copy');
    write(path.join(dir, 'Calibre Book.epub'));
    load(ebookRequest(book(dir, { filesHash: null }), { placedEbookFiles: [entryFor(path.join(dir, 'Book.epub'))] }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(['Calibre Book.epub']);
  });

  it('second ebook request for the same book in another format: deleting A removes only A\'s epub', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.epub', 'Book.azw3']);
    otherRecords = [{ placedEbookFiles: [entryFor(path.join(dir, 'Book.azw3'))] }];
    load(ebookRequest(book(dir), { placedEbookFiles: [entryFor(path.join(dir, 'Book.epub'))] }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(true);
    expect(fs.existsSync(path.join(dir, 'Book.epub'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'Book.azw3'))).toBe(true);
  });

  it('keeps a file another active request also recorded, and looks at every active request (not only this book\'s)', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.epub']);
    const entry = entryFor(path.join(dir, 'Book.epub'));
    otherRecords = [{ placedEbookFiles: [entry] }];
    load(ebookRequest(book(dir), { placedEbookFiles: [entry] }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(false);
    expect(result.filesKeptReason).toBe('Book.epub is also the ebook of another request');
    expect(fs.existsSync(path.join(dir, 'Book.epub'))).toBe(true);
    const where = prismaMock.request.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: { not: 'req-1' }, deletedAt: null });
    expect(where.audiobookId).toBeUndefined();
  });

  it('a recycled request (Manual Import failed after an earlier delivery) still removes the file its earlier import placed', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.epub']);
    load(ebookRequest(book(dir), { status: 'failed', placedEbookFiles: [entryFor(path.join(dir, 'Book.epub'))] }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(true);
    expect(fs.existsSync(path.join(dir, 'Book.epub'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'Book.m4b'))).toBe(true);
  });

  it('custom ebook_path_template: the recorded file in its own folder is removed even though filePath is the audio folder', async () => {
    const audioDir = imported(lib.media, 'Author/Book');
    const ebook = write(path.join(lib.media, 'Ebooks', 'Author', 'Book.epub'), 'rmab ebook');
    write(path.join(lib.media, 'Ebooks', 'Author', 'Other.epub'));
    load(ebookRequest(book(audioDir), { placedEbookFiles: [entryFor(ebook)] }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(true);
    expect(fs.existsSync(ebook)).toBe(false);
    expect(fs.existsSync(path.join(lib.media, 'Ebooks', 'Author', 'Other.epub'))).toBe(true);
    expect(fs.readdirSync(audioDir).sort()).toEqual(['Book.m4b', 'cover.jpg']);
  });

  it('a recorded file in a flat folder another book points at is kept (rule c), with the reason', async () => {
    const dir = path.join(lib.media, 'Ebooks');
    write(path.join(dir, 'Book.epub'));
    otherBooks = [{ id: 'book-2', title: 'Second', filePath: dir }];
    load(ebookRequest(book(dir, { filesHash: null }), { placedEbookFiles: [entryFor(path.join(dir, 'Book.epub'))] }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe('it is also the folder of "Second"');
    expect(fs.existsSync(path.join(dir, 'Book.epub'))).toBe(true);
  });
});

describe('#497: "another request recorded this file" means the same file, not the same spelling', () => {
  /** Book.epub in a real title folder, and a second spelling of that folder (a symlinked folder). */
  function twoSpellings() {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.epub']);
    const alias = path.join(lib.media, 'Alias', 'Book');
    fs.mkdirSync(path.dirname(alias), { recursive: true });
    fs.symlinkSync(dir, alias, 'junction');
    const entry = entryFor(path.join(dir, 'Book.epub'));
    return { dir, entry, aliasEntry: { ...entry, path: path.join(alias, 'Book.epub') } };
  }

  it.each(['the other request', 'this request'])('keeps the file when %s recorded it through a symlinked folder', async (via) => {
    const { dir, entry, aliasEntry } = twoSpellings();
    otherRecords = [{ placedEbookFiles: [via === 'the other request' ? aliasEntry : entry] }];
    load(ebookRequest(book(dir), { placedEbookFiles: [via === 'the other request' ? entry : aliasEntry] }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe('Book.epub is also the ebook of another request');
    expect(fs.existsSync(path.join(dir, 'Book.epub'))).toBe(true);
  });

  it('a stale record of another request at the same path (other bytes) does not keep this file', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.epub']);
    const entry = entryFor(path.join(dir, 'Book.epub'));
    otherRecords = [{ placedEbookFiles: [{ ...entry, sha256: 'a'.repeat(64) }] }];
    load(ebookRequest(book(dir), { placedEbookFiles: [entry] }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(true);
    expect(result.filesKeptReason).toBeUndefined();
    expect(fs.existsSync(path.join(dir, 'Book.epub'))).toBe(false);
  });
});

describe('#497: kept reasons', () => {
  it('a request delivered before its first record (a pre-upgrade import, then a Manual Import of another format): the new file goes, the old one stays, with the reason', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.pdf', 'Book.epub']);
    load(ebookRequest(book(dir), { placedEbookFiles: [MARKER, entryFor(path.join(dir, 'Book.epub'))] }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(true);
    expect(result.filesKeptReason).toBe(EARLIER);
    expect(fs.readdirSync(dir).sort()).toEqual(['Book.m4b', 'Book.pdf', 'cover.jpg']);
  });

  it('a re-import of a pre-upgrade request that found its file already there keeps it with the earlier-import reason', async () => {
    const dir = imported(lib.media, 'Author/Book', ['Book.m4b'], ['Book.epub']);
    const before = snapshot(lib.media);
    load(ebookRequest(book(dir), { placedEbookFiles: [MARKER] }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(false);
    expect(result.filesKeptReason).toBe(EARLIER);
    expect(snapshot(lib.media)).toEqual(before);
  });

  it('two recorded files kept for the same reason: the reason shows once', async () => {
    const dir = path.join(lib.media, 'Ebooks');
    write(path.join(dir, 'Book.epub'));
    write(path.join(dir, 'Book.pdf'));
    otherBooks = [{ id: 'book-2', title: 'Second', filePath: dir }];
    load(ebookRequest(book(dir, { filesHash: null }), {
      placedEbookFiles: [entryFor(path.join(dir, 'Book.epub')), entryFor(path.join(dir, 'Book.pdf'))],
    }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe('it is also the folder of "Second"');
    expect(fs.readdirSync(dir).sort()).toEqual(['Book.epub', 'Book.pdf']);
  });
});
