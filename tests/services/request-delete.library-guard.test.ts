/**
 * Component: Request Delete Library Guard Tests (real filesystem)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * deleteRequest end to end with real temp folders: what it removes, what it
 * keeps, and that backend items and library records are touched only after
 * RMAB removed the folder itself.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { generateFilesHash } from '@/lib/utils/files-hash';

const prismaMock = createPrismaMock();
const configServiceMock = { get: vi.fn(), getBackendMode: vi.fn() };
const absMock = vi.hoisted(() => ({ getABSItem: vi.fn(), deleteABSItem: vi.fn() }));
const plexMock = vi.hoisted(() => ({ getItemFilePaths: vi.fn(), deleteItem: vi.fn() }));
const rmState = vi.hoisted(() => ({ error: null as NodeJS.ErrnoException | null }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/audiobookshelf/api', () => absMock);
vi.mock('@/lib/integrations/plex.service', () => ({ getPlexService: () => plexMock }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const rm = (async (...args: Parameters<typeof actual.rm>) => {
    if (rmState.error) throw rmState.error;
    return actual.rm(...args);
  }) as typeof actual.rm;
  return { ...actual, default: { ...actual, rm }, rm };
});

const { deleteRequest } = await import('@/lib/services/request-delete.service');
const { audiobookFolderKeptReason } = await import('@/lib/services/request-delete-files');

let root: string;
let media: string;
let downloads: string;
let otherBooks: Array<{ id: string; title: string; filePath: string | null }>;

function write(file: string, content = 'x') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/** An imported title folder: audio + cover (+ extra files), and the book row RMAB stored for it. */
function imported(rel: string, audio = ['Book.m4b'], extra: string[] = []) {
  const dir = path.join(media, rel);
  for (const name of [...audio, 'cover.jpg', ...extra]) write(path.join(dir, name));
  return dir;
}

function book(filePath: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id: 'book-1',
    title: 'Book',
    author: 'Author',
    narrator: null,
    audibleAsin: 'B0TEST0001',
    plexGuid: null,
    absItemId: 'abs-1',
    filePath,
    fileFormat: 'm4b',
    filesHash: generateFilesHash(['Book.m4b']),
    ...overrides,
  };
}

function request(audiobook: ReturnType<typeof book>, type = 'audiobook') {
  prismaMock.request.findFirst.mockResolvedValue({ id: 'req-1', type, audiobook, downloadHistory: [] });
}

/** Library left exactly as it was: no backend delete, no record cleanup, no status reset. */
function expectLibraryUntouched() {
  expect(absMock.deleteABSItem).not.toHaveBeenCalled();
  expect(plexMock.deleteItem).not.toHaveBeenCalled();
  expect(prismaMock.plexLibrary.deleteMany).not.toHaveBeenCalled();
  expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
  expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deletedBy: 'admin-1' }) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  rmState.error = null;
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-delete-guard-')));
  media = path.join(root, 'media');
  downloads = path.join(root, 'downloads');
  fs.mkdirSync(media, { recursive: true });
  fs.mkdirSync(downloads, { recursive: true });
  otherBooks = [];
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
    if (where.key === 'media_dir') return { value: media };
    if (where.key === 'download_dir') return { value: downloads };
    return null;
  });
  prismaMock.audiobook.findMany.mockImplementation(async () => otherBooks);
  prismaMock.request.findMany.mockResolvedValue([]);
  prismaMock.plexLibrary.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.plexLibrary.findMany.mockResolvedValue([]);
  prismaMock.plexLibrary.findUnique.mockResolvedValue({ plexRatingKey: '42' });
  configServiceMock.getBackendMode.mockResolvedValue('audiobookshelf');
  configServiceMock.get.mockImplementation(async (key: string) => (key === 'plex_url' ? 'http://plex' : key === 'plex_token' ? 'tok' : null));
  absMock.deleteABSItem.mockResolvedValue(undefined);
  plexMock.deleteItem.mockResolvedValue(undefined);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('deleteRequest (audiobook): stored folder behind the guard', () => {
  it('removes a default-template folder (ebook inside too), sweeps the empty author folder, ABS without files, clears the row', async () => {
    const dir = imported('Author/Book B0TEST0001', ['Book.m4b'], ['Book.epub']);
    absMock.getABSItem.mockResolvedValue({ path: dir, relPath: 'Author/Book B0TEST0001' });
    request(book(dir, { fileFormat: 'epub' }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result).toMatchObject({ success: true, filesDeleted: true, message: 'Request deleted successfully' });
    expect(result.filesKeptReason).toBeUndefined();
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.existsSync(path.join(media, 'Author'))).toBe(false);
    expect(fs.existsSync(media)).toBe(true);
    expect(absMock.deleteABSItem).toHaveBeenCalledWith('abs-1', { hard: false });
    expect(prismaMock.plexLibrary.deleteMany).toHaveBeenCalled();
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith({
      where: { id: 'book-1' },
      data: expect.objectContaining({ status: 'requested', absItemId: null, filePath: null, filesHash: null, fileFormat: null }),
    });
  });

  it.each([
    ['foreign audio added to the folder', () => imported('Author/Book', ['Book.m4b', 'Bonus.mp3']), 'folder contents changed since import'],
    ['an import where nothing was ours (no files hash)', () => imported('Author/Book'), 'no import record'],
    ['audio in a subfolder', () => { const d = imported('Author/Book'); write(path.join(d, 'Disc 2', 'x.mp3')); return d; }, 'audio files in a subfolder'],
    ['the media root itself', () => media, 'it is the media library root'],
  ])('keeps everything for %s', async (_label, setup, reason) => {
    const dir = setup();
    const before = fs.readdirSync(media, { recursive: true }).length;
    request(book(dir, reason === 'no import record' ? { filesHash: null } : {}));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.success).toBe(true);
    expect(result.filesDeleted).toBe(false);
    expect(result.filesKeptReason).toContain(reason);
    expect(result.message).toBe(`Request deleted; files kept: ${result.filesKeptReason}`);
    expect(fs.readdirSync(media, { recursive: true }).length).toBe(before);
    expect(absMock.getABSItem).not.toHaveBeenCalled();
    expectLibraryUntouched();
  });

  it('keeps an {author} folder that holds another book', async () => {
    const authorDir = path.join(media, 'Author');
    write(path.join(authorDir, 'Book.m4b'));
    const other = imported('Author/Other Book');
    otherBooks = [{ id: 'book-2', title: 'Other Book', filePath: other }];
    request(book(authorDir));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe('it contains the folder of "Other Book"');
    expect(fs.existsSync(path.join(other, 'Book.m4b'))).toBe(true);
    expectLibraryUntouched();
  });

  it('keeps a title folder that is a symlink to a seeding folder; the target is intact', async () => {
    const seeding = path.join(downloads, 'Book [seed]');
    write(path.join(seeding, 'Book.m4b'));
    const link = path.join(media, 'Author', 'Book');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(seeding, link, 'junction');
    request(book(link));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toContain('outside the media library');
    expect(fs.existsSync(path.join(seeding, 'Book.m4b'))).toBe(true);
    expectLibraryUntouched();
  });

  it('keeps everything when the folder cannot be removed (EACCES): no backend delete, fields stay', async () => {
    const dir = imported('Author/Book');
    rmState.error = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    request(book(dir));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe('the folder was partly removed (permission denied); remove the rest manually');
    expect(fs.existsSync(dir)).toBe(true);
    expectLibraryUntouched();
  });

  it('keeps library files when RMAB has no stored folder but the book is linked to a library item', async () => {
    request(book(null));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toContain('no stored folder');
    expectLibraryUntouched();
  });

  it('still resets a never-imported book (no folder, no library item) without any backend call', async () => {
    request(book(null, { absItemId: null, filesHash: null }));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBeUndefined();
    expect(absMock.getABSItem).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'requested' }) }));
  });

  it('leaves an ABS item whose files are elsewhere (a second copy), and still clears the row', async () => {
    const dir = imported('Author/Book');
    absMock.getABSItem.mockResolvedValue({ path: path.join(root, 'other-library', 'Book'), relPath: 'Book' });
    request(book(dir));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(true);
    expect(absMock.deleteABSItem).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ absItemId: null, filePath: null }) }));
  });

  it('matches an ABS item by its path relative to the library folder when ABS mounts the library elsewhere', async () => {
    const dir = imported('Author/Book');
    absMock.getABSItem.mockResolvedValue({ path: '/audiobooks/Author/Book', relPath: 'Author/Book' });
    request(book(dir));

    await deleteRequest('req-1', 'admin-1');

    expect(absMock.deleteABSItem).toHaveBeenCalledWith('abs-1', { hard: false });
  });

  it('a folder already gone (library mounted): library item deleted only if it lived there, row cleared', async () => {
    imported('Other Author/Other Book');
    const gone = path.join(media, 'Author', 'Gone');
    absMock.getABSItem.mockResolvedValue({ path: gone });
    request(book(gone));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(false);
    expect(result.filesKeptReason).toBeUndefined();
    expect(absMock.deleteABSItem).toHaveBeenCalledWith('abs-1', { hard: false });
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ filePath: null }) }));
  });

  it('a missing folder on an empty (unmounted) media volume: everything kept, row and linkage stay', async () => {
    const gone = path.join(media, 'Author', 'Gone');
    absMock.getABSItem.mockResolvedValue({ path: gone });
    request(book(gone));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toContain('is the media volume mounted?');
    expect(absMock.getABSItem).not.toHaveBeenCalled();
    expectLibraryUntouched();
  });

  it('a stored folder that is gone and outside the current media_dir (library moved) is a stale record: path cleared, nothing else', async () => {
    const old = path.join(root, 'old-library', 'Author', 'Book');
    request(book(old));

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBeUndefined();
    expect(result.message).toContain('no longer exists outside the current media library');
    expect(absMock.getABSItem).not.toHaveBeenCalled();
    expect(absMock.deleteABSItem).not.toHaveBeenCalled();
    expect(prismaMock.plexLibrary.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith({
      where: { id: 'book-1' },
      data: expect.objectContaining({ filePath: null, filesHash: null, fileFormat: null }),
    });
    expect(prismaMock.audiobook.update.mock.calls[0][0].data.status).toBeUndefined();
  });

  it('replace pre-check: a library move lets the replace go on; a shared stored folder still refuses', async () => {
    expect(await audiobookFolderKeptReason(book(path.join(root, 'old-library', 'Author', 'Book')))).toBeNull();

    const shared = path.join(media, 'Ebooks');
    write(path.join(shared, 'Book.epub'));
    otherBooks = [{ id: 'book-2', title: 'Second', filePath: shared }];
    expect(await audiobookFolderKeptReason(book(shared))).toBe('it is also the folder of "Second"');
  });

  describe('Plex', () => {
    beforeEach(() => configServiceMock.getBackendMode.mockResolvedValue('plex'));

    it('deletes the Plex item only when all its files were inside the removed folder', async () => {
      const dir = imported('Author/Book');
      plexMock.getItemFilePaths.mockResolvedValue([path.join(dir, 'Book.m4b')]);
      request(book(dir, { absItemId: null, plexGuid: 'plex://album/1' }));

      await deleteRequest('req-1', 'admin-1');

      expect(plexMock.deleteItem).toHaveBeenCalledWith('http://plex', 'tok', '42');
      expect(prismaMock.audiobook.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ plexGuid: null }) }));
    });

    it.each([
      ['files outside the folder', (dir: string) => [path.join(dir, 'Book.m4b'), path.join(root, 'elsewhere', 'Book.m4b')]],
      ['no files listed', () => []],
    ])('skips the Plex delete with %s (the next scan drops it)', async (_label, files) => {
      const dir = imported('Author/Book');
      plexMock.getItemFilePaths.mockResolvedValue(files(dir));
      request(book(dir, { absItemId: null, plexGuid: 'plex://album/1' }));

      await deleteRequest('req-1', 'admin-1');

      expect(plexMock.deleteItem).not.toHaveBeenCalled();
    });

    it('leaves the Plex item alone when the folder was already gone (no evidence its files are)', async () => {
      imported('Other Author/Other Book');
      const gone = path.join(media, 'Author', 'Gone');
      plexMock.getItemFilePaths.mockResolvedValue([path.join(gone, 'Book.m4b')]);
      request(book(gone, { absItemId: null, plexGuid: 'plex://album/1' }));

      const result = await deleteRequest('req-1', 'admin-1');

      expect(result.filesKeptReason).toBeUndefined();
      expect(plexMock.getItemFilePaths).not.toHaveBeenCalled();
      expect(plexMock.deleteItem).not.toHaveBeenCalled();
    });

    it('never asks Plex anything when files are kept', async () => {
      const dir = imported('Author/Book', ['Book.m4b', 'Extra.mp3']);
      request(book(dir, { absItemId: null, plexGuid: 'plex://album/1' }));

      await deleteRequest('req-1', 'admin-1');

      expect(plexMock.getItemFilePaths).not.toHaveBeenCalled();
      expectLibraryUntouched();
    });
  });

  it('soft-deletes linked ebook requests and parentless ebook requests on the same book', async () => {
    const dir = imported('Author/Book');
    absMock.getABSItem.mockResolvedValue({ path: dir });
    prismaMock.request.findMany.mockResolvedValue([{ id: 'ebook-1', type: 'ebook' }, { id: 'ebook-2', type: 'ebook' }]);
    request(book(dir));

    await deleteRequest('req-1', 'admin-1');

    expect(prismaMock.request.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        deletedAt: null,
        OR: [{ parentRequestId: 'req-1' }, { type: 'ebook', parentRequestId: null, audiobookId: 'book-1' }],
      },
    }));
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['ebook-1', 'ebook-2'] } },
      data: expect.objectContaining({ deletedBy: 'admin-1' }),
    });
  });
});

describe('deleteRequest (ebook): ebook files behind the guard', () => {
  it('removes the ebooks in a folder that passes the evidence rule; audio stays; no backend or row changes', async () => {
    const dir = imported('Author/Book', ['Book.m4b'], ['Book.epub']);
    request(book(dir), 'ebook');

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(true);
    expect(fs.existsSync(path.join(dir, 'Book.epub'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'Book.m4b'))).toBe(true);
    expectLibraryUntouched();
  });

  it('removes the only ebook in a flat Ebooks folder', async () => {
    const dir = path.join(media, 'Ebooks');
    write(path.join(dir, 'Book.epub'));
    request(book(dir, { filesHash: null }), 'ebook');

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(true);
    expect(fs.existsSync(path.join(dir, 'Book.epub'))).toBe(false);
  });

  it('keeps a flat folder holding foreign ebooks besides this one, and says why', async () => {
    const dir = path.join(media, 'Ebooks');
    write(path.join(dir, 'Book.epub'));
    write(path.join(dir, 'Calibre Book.epub'));
    request(book(dir, { filesHash: null }), 'ebook');

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesDeleted).toBe(false);
    expect(result.filesKeptReason).toContain('holds 2 ebook files');
    expect(fs.readdirSync(dir).sort()).toEqual(['Book.epub', 'Calibre Book.epub']);
  });

  it('keeps a folder another book also points at', async () => {
    const dir = path.join(media, 'Ebooks');
    write(path.join(dir, 'Book.epub'));
    otherBooks = [{ id: 'book-2', title: 'Second', filePath: dir }];
    request(book(dir, { filesHash: null }), 'ebook');

    const result = await deleteRequest('req-1', 'admin-1');

    expect(result.filesKeptReason).toBe('it is also the folder of "Second"');
    expect(fs.existsSync(path.join(dir, 'Book.epub'))).toBe(true);
  });
});
