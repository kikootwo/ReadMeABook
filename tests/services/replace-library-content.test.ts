/**
 * Component: Replace Library Content Tests (no active request)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * A stored folder (e.g. kept by an earlier admin delete) is removed only
 * through the library delete guard and never with an ABS hard delete; only a
 * book added outside RMAB (no stored folder) is removed by the backend alone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const filesMock = vi.hoisted(() => ({ removeAudiobookFolder: vi.fn(), deleteBackendItem: vi.fn(), deleteLibraryRecords: vi.fn() }));
const absMock = vi.hoisted(() => ({ deleteABSItem: vi.fn() }));
const configMock = vi.hoisted(() => ({ get: vi.fn(), getBackendMode: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/request-delete-files', () => filesMock);
vi.mock('@/lib/services/audiobookshelf/api', () => absMock);
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));

const { removeLibraryContentForReplace } = await import('@/lib/services/replace-library-content');

const book = {
  id: 'book-1',
  title: 'Book',
  author: 'Author',
  audibleAsin: 'B0TEST0001',
  plexGuid: null,
  absItemId: 'abs-1',
  filePath: '/media/Author/Book',
  filesHash: 'hash',
};

beforeEach(() => {
  vi.clearAllMocks();
  configMock.getBackendMode.mockResolvedValue('audiobookshelf');
  prismaMock.plexLibrary.deleteMany.mockResolvedValue({ count: 0 });
});

describe('removeLibraryContentForReplace', () => {
  it('keeps a stored folder the guard refuses: returns the reason, no ABS delete at all', async () => {
    filesMock.removeAudiobookFolder.mockResolvedValue({ kind: 'kept', reason: 'folder contents changed since import' });

    expect(await removeLibraryContentForReplace(book)).toBe('folder contents changed since import');
    expect(absMock.deleteABSItem).not.toHaveBeenCalled();
    expect(filesMock.deleteBackendItem).not.toHaveBeenCalled();
    expect(filesMock.deleteLibraryRecords).not.toHaveBeenCalled();
  });

  it('removes a stored folder through the guard, then the backend item (hard=0 path) and records', async () => {
    const outcome = { kind: 'removed', folder: '/media/Author/Book', mediaDir: '/media' };
    filesMock.removeAudiobookFolder.mockResolvedValue(outcome);

    expect(await removeLibraryContentForReplace(book)).toBeNull();
    expect(filesMock.deleteBackendItem).toHaveBeenCalledWith(book, outcome, 'audiobookshelf', configMock);
    expect(filesMock.deleteLibraryRecords).toHaveBeenCalledWith(book);
    expect(absMock.deleteABSItem).not.toHaveBeenCalled();
  });

  it('a stale stored folder (library moved) is not removed or protected: nothing touched, the replace goes on', async () => {
    filesMock.removeAudiobookFolder.mockResolvedValue({ kind: 'stale', folder: '/old/Author/Book' });

    expect(await removeLibraryContentForReplace(book)).toBeNull();
    expect(filesMock.deleteBackendItem).not.toHaveBeenCalled();
    expect(filesMock.deleteLibraryRecords).not.toHaveBeenCalled();
    expect(absMock.deleteABSItem).not.toHaveBeenCalled();
  });

  it('a row cleared by an earlier "already gone" delete (no path, no item): no ABS delete when no library row matches', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    const cleared = { ...book, filePath: null, filesHash: null, absItemId: null };

    expect(await removeLibraryContentForReplace(cleared)).toBeNull();
    expect(absMock.deleteABSItem).not.toHaveBeenCalled();
  });

  it('refuses the ABS hard delete when several library items share the ASIN', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ plexGuid: 'abs-a' }, { plexGuid: 'abs-b' }]);
    const cleared = { ...book, filePath: null, filesHash: null, absItemId: null };

    expect(await removeLibraryContentForReplace(cleared)).toBe('several library items match ASIN B0TEST0001, so none was deleted');
    expect(absMock.deleteABSItem).not.toHaveBeenCalled();
    expect(prismaMock.plexLibrary.deleteMany).not.toHaveBeenCalled();
  });

  it('hard-deletes the one library item matching the ASIN of a book added outside RMAB', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ plexGuid: 'abs-only' }]);

    expect(await removeLibraryContentForReplace({ ...book, filePath: null, filesHash: null, absItemId: null })).toBeNull();
    expect(absMock.deleteABSItem).toHaveBeenCalledWith('abs-only', { hard: true });
  });

  it('a book added outside RMAB (no stored folder) is removed by the backend, as before', async () => {
    expect(await removeLibraryContentForReplace({ ...book, filePath: null, filesHash: null })).toBeNull();
    expect(filesMock.removeAudiobookFolder).not.toHaveBeenCalled();
    expect(absMock.deleteABSItem).toHaveBeenCalledWith('abs-1', { hard: true });
  });
});
