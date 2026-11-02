/**
 * Component: Ebook Request Delete Tests: checks on the recorded file (#497, real filesystem)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * deleteRequest for an ebook request with a placement record: the recorded file
 * goes only when the record reads, rules a-c pass on its folder and the file is
 * still exactly what RMAB placed. Reached only through deleteRequest.
 */

import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { book, ebookRequest, entryFor, imported, makeLibrary, snapshot, write, type Library } from './request-delete-ebook-fixture';

const prismaMock = createPrismaMock();
const configServiceMock = { get: vi.fn(), getBackendMode: vi.fn() };
const unlinkState = vi.hoisted(() => ({ error: null as NodeJS.ErrnoException | null }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/audiobookshelf/api', () => ({ getABSItem: vi.fn(), deleteABSItem: vi.fn() }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const unlink = (async (...args: Parameters<typeof actual.unlink>) => {
    if (unlinkState.error) throw unlinkState.error;
    return actual.unlink(...args);
  }) as typeof actual.unlink;
  return { ...actual, default: { ...actual, unlink }, unlink };
});

const { deleteRequest } = await import('@/lib/services/request-delete.service');

const UNREADABLE = 'the placement record could not be read';

let lib: Library;
let otherBooks: Array<{ id: string; title: string; filePath: string | null }>;
let downloadDir: string;

/** A title folder with audio and RMAB's Book.epub, and the request recording that epub. */
function placed(content = 'rmab epub') {
  const dir = imported(lib.media, 'Author/Book');
  const file = write(path.join(dir, 'Book.epub'), content);
  return { dir, file, entry: entryFor(file) };
}

function load(filePath: string | null, placedEbookFiles: unknown, overrides: Record<string, unknown> = {}) {
  prismaMock.request.findFirst.mockResolvedValue(ebookRequest(book(filePath, overrides), { placedEbookFiles }));
}

beforeEach(() => {
  vi.clearAllMocks();
  unlinkState.error = null;
  lib = makeLibrary('rmab-497-guard-');
  downloadDir = lib.downloads;
  otherBooks = [];
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
    if (where.key === 'media_dir') return { value: lib.media };
    if (where.key === 'download_dir') return { value: downloadDir };
    return null;
  });
  prismaMock.audiobook.findMany.mockImplementation(async () => otherBooks);
  prismaMock.request.findMany.mockResolvedValue([]);
  configServiceMock.getBackendMode.mockResolvedValue('audiobookshelf');
  configServiceMock.get.mockResolvedValue(null);
});

afterEach(() => {
  fs.rmSync(lib.root, { recursive: true, force: true });
});

describe('#497: the recorded file must still be what RMAB placed', () => {
  it('keeps a recorded file whose content changed (same size, other bytes)', async () => {
    const { dir, file, entry } = placed('rmab epub');
    fs.writeFileSync(file, 'user epub');
    load(dir, [entry]);

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(false);
    expect(result.filesKeptReason).toBe('Book.epub changed since RMAB placed it');
    expect(fs.readFileSync(file, 'utf8')).toBe('user epub');
  });

  it('keeps a recorded file whose size changed', async () => {
    const { dir, file, entry } = placed();
    fs.writeFileSync(file, 'a longer user edition');
    load(dir, [entry]);

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe('Book.epub changed since RMAB placed it');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('keeps a recorded file replaced by a link (junction/symlink); the link and its target stay', async () => {
    const { dir, file, entry } = placed();
    const elsewhere = path.join(lib.root, 'calibre', 'Shelf');
    write(path.join(elsewhere, 'Book.epub'), 'rmab epub');
    fs.rmSync(file);
    fs.symlinkSync(elsewhere, file, 'junction');
    load(dir, [entry]);

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe('Book.epub is no longer the file RMAB placed');
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(elsewhere, 'Book.epub'))).toBe(true);
  });

  it('keeps a recorded path that is now a folder', async () => {
    const { dir, file, entry } = placed();
    fs.rmSync(file);
    write(path.join(file, 'inside.txt'));
    load(dir, [entry]);

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe('Book.epub is no longer the file RMAB placed');
    expect(fs.existsSync(path.join(file, 'inside.txt'))).toBe(true);
  });

  it('a recorded file that is already gone: nothing removed, no reason, the rest of the folder stays', async () => {
    const { dir, file, entry } = placed();
    fs.rmSync(file);
    const before = snapshot(lib.media);
    load(dir, [entry]);

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result).toMatchObject({ success: true, filesDeleted: false, message: 'Request deleted successfully' });
    expect(snapshot(lib.media)).toEqual(before);
  });

  it('two entries: removes the intact one, keeps the changed one and says which', async () => {
    const { dir, file, entry } = placed();
    const pdf = write(path.join(dir, 'Book.pdf'), 'rmab pdf');
    const pdfEntry = entryFor(pdf);
    fs.writeFileSync(pdf, 'user pdf');
    load(dir, [entry, pdfEntry]);

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(true);
    expect(result.filesKeptReason).toBe('Book.pdf changed since RMAB placed it');
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(pdf, 'utf8')).toBe('user pdf');
  });

  it('an unlink failure keeps the file and says why', async () => {
    const { dir, file, entry } = placed();
    unlinkState.error = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    load(dir, [entry]);

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe('Book.epub could not be removed (permission denied)');
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe('#497: an unreadable record keeps the file', () => {
  const sha = 'a'.repeat(64);
  it.each([
    ['a relative path', () => [{ path: 'Author/Book/Book.epub', size: 9, sha256: sha }]],
    ['a path with a NUL', (file: string) => [{ path: `${file}\0.epub`, size: 9, sha256: sha }]],
    ['a non-ebook file', (file: string) => [{ path: path.join(path.dirname(file), 'Book.m4b'), size: 9, sha256: sha }]],
    ['a short sha256', (file: string) => [{ ...entryFor(file), sha256: 'abc' }]],
    ['an unsafe size', (file: string) => [{ ...entryFor(file), size: Number.MAX_SAFE_INTEGER + 1 }]],
    ['a negative size', (file: string) => [{ ...entryFor(file), size: -1 }]],
    ['a non-array record', (file: string) => ({ path: file })],
    ['an entry that is not an object', () => ['Book.epub']],
  ] as Array<[string, (file: string) => unknown]>)('%s: kept with the reason', async (_label, record) => {
    const { dir, file } = placed();
    const before = snapshot(lib.media);
    load(dir, record(file));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(false);
    expect(result.filesKeptReason).toBe(UNREADABLE);
    expect(snapshot(lib.media)).toEqual(before);
  });
});

describe('#497: rules a-c on the recorded file\'s own folder', () => {
  it('a recorded path outside the media library is kept', async () => {
    const outside = write(path.join(lib.root, 'calibre', 'Book.epub'), 'rmab epub');
    load(imported(lib.media, 'Author/Book'), [entryFor(outside)]);

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toContain('it is outside the media library');
    expect(fs.existsSync(outside)).toBe(true);
  });

  it('a recorded file directly in the media root is kept', async () => {
    const atRoot = write(path.join(lib.media, 'Book.epub'), 'rmab epub');
    load(null, [entryFor(atRoot)]);

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe('it is the media library root');
    expect(fs.existsSync(atRoot)).toBe(true);
  });

  it('a recorded file in a configured root (download folder inside the library) is kept', async () => {
    downloadDir = path.join(lib.media, 'incoming');
    const file = write(path.join(downloadDir, 'Book.epub'), 'rmab epub');
    load(null, [entryFor(file)]);

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toContain('it is a configured root');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('a folder that contains another book\'s folder is kept', async () => {
    const authorDir = path.join(lib.media, 'Author');
    const file = write(path.join(authorDir, 'Book.epub'), 'rmab epub');
    const other = imported(lib.media, 'Author/Other Book');
    otherBooks = [{ id: 'book-2', title: 'Other Book', filePath: other }];
    load(authorDir, [entryFor(file)], { filesHash: null });

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe('it contains the folder of "Other Book"');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('a symlinked title folder inside the library: the real file goes, the link stays', async () => {
    const real = imported(lib.media, 'Real/Book');
    const file = write(path.join(real, 'Book.epub'), 'rmab epub');
    const link = path.join(lib.media, 'Author', 'Book');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(real, link, 'junction');
    load(link, [{ ...entryFor(file), path: path.join(link, 'Book.epub') }]);

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(real).sort()).toEqual(['Book.m4b', 'cover.jpg']);
  });

  it('a symlinked title folder pointing outside the library is kept; the target is intact', async () => {
    const seeding = path.join(lib.downloads, 'Book [seed]');
    const file = write(path.join(seeding, 'Book.epub'), 'rmab epub');
    const link = path.join(lib.media, 'Author', 'Book');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(seeding, link, 'junction');
    load(link, [{ ...entryFor(file), path: path.join(link, 'Book.epub') }]);

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toContain('outside the media library');
    expect(fs.existsSync(file)).toBe(true);
  });
});
