/**
 * Component: Request Delete Service Tests - bulk delete refusal (#212)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * deleteRequest(id, admin, { refuseInLibrary: true }) refuses, before any side effect, a request
 * whose book is in the library (folder, library item, placed ebook files) or being imported (a
 * live request on the same book is processing), judged on its own load. Without the option the
 * delete runs exactly as before.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const filesMock = vi.hoisted(() => ({
  removeAudiobookFolder: vi.fn(),
  removeEbookFiles: vi.fn(),
  deleteBackendItem: vi.fn(),
  deleteLibraryRecords: vi.fn(),
  describeKept: vi.fn(() => ''),
}));
const downloadMock = vi.hoisted(() => ({
  cleanUpRequestDownload: vi.fn(),
  emptyDownloadCleanupCounts: () => ({
    torrentsRemoved: 0, torrentsKeptSeeding: 0, torrentsKeptUnlimited: 0, torrentsKeptShared: 0, torrentsKeptNotOwned: 0,
  }),
}));
const childrenMock = vi.hoisted(() => ({
  findChildRequests: vi.fn(),
  keepDeliveredChildren: vi.fn(),
  clearRemovedEbookFolder: vi.fn(),
}));
const configServiceMock = vi.hoisted(() => ({ getBackendMode: vi.fn(async () => 'audiobookshelf') }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/request-delete-files', () => filesMock);
vi.mock('@/lib/services/request-delete-download', () => downloadMock);
vi.mock('@/lib/services/request-delete-children', () => childrenMock);
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));

const BOOK = { id: 'ab-1', title: 'Made Up Book', author: 'Made Up Author', narrator: null, audibleAsin: 'B0FAKE0001', fileFormat: null, filesHash: null };

function loadRequest(over: { type?: string; status?: string; placedEbookFiles?: unknown; book?: Record<string, unknown> } = {}) {
  prismaMock.request.findFirst.mockResolvedValue({
    id: 'req-1',
    audiobookId: 'ab-1',
    type: over.type ?? 'audiobook',
    status: over.status ?? 'failed',
    completedAt: null,
    placedEbookFiles: over.placedEbookFiles ?? null,
    audiobook: { ...BOOK, filePath: null, absItemId: null, plexGuid: null, ...over.book },
    downloadHistory: [{ id: 'dh-1', indexerName: 'Fake Indexer', torrentHash: 'hash-1' }],
  });
}

/** Nothing at all happened: no download step, no files, no library records, no soft delete. */
function expectNoSideEffect() {
  expect(downloadMock.cleanUpRequestDownload).not.toHaveBeenCalled();
  expect(filesMock.removeAudiobookFolder).not.toHaveBeenCalled();
  expect(filesMock.removeEbookFiles).not.toHaveBeenCalled();
  expect(filesMock.deleteBackendItem).not.toHaveBeenCalled();
  expect(filesMock.deleteLibraryRecords).not.toHaveBeenCalled();
  expect(childrenMock.findChildRequests).not.toHaveBeenCalled();
  expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
  expect(prismaMock.request.update).not.toHaveBeenCalled();
}

async function run(options?: { refuseInLibrary?: boolean }) {
  const { deleteRequest } = await import('@/lib/services/request-delete.service');
  return options ? deleteRequest('req-1', 'admin-1', options) : deleteRequest('req-1', 'admin-1');
}

describe('deleteRequest refuseInLibrary (bulk delete)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.count.mockResolvedValue(0);
    downloadMock.cleanUpRequestDownload.mockResolvedValue(downloadMock.emptyDownloadCleanupCounts());
    filesMock.removeAudiobookFolder.mockResolvedValue({ kind: 'none' });
    filesMock.removeEbookFiles.mockResolvedValue({ deleted: 0 });
    childrenMock.findChildRequests.mockResolvedValue({ delivered: [], undelivered: [], survivorFolder: null });
  });

  it('refuses a request whose book has a stored folder, changing nothing', async () => {
    loadRequest({ book: { filePath: '/media/Made Up Author/Made Up Book' } });
    const result = await run({ refuseInLibrary: true });
    expect(result).toMatchObject({ success: false, error: 'InLibrary' });
    expectNoSideEffect();
  });

  it.each([
    ['an Audiobookshelf item', { absItemId: 'abs-item-1' }],
    ['a Plex item', { plexGuid: 'plex://fake/1' }],
  ])('refuses a request whose book has %s and no folder', async (_label, book) => {
    loadRequest({ book });
    expect(await run({ refuseInLibrary: true })).toMatchObject({ success: false, error: 'InLibrary' });
    expectNoSideEffect();
  });

  it('refuses an ebook request whose imports placed files', async () => {
    loadRequest({ type: 'ebook', status: 'downloaded', placedEbookFiles: [{ path: '/media/x/book.epub', size: 1, sha256: 'a', placedAt: 'now' }] });
    expect(await run({ refuseInLibrary: true })).toMatchObject({ success: false, error: 'InLibrary' });
    expectNoSideEffect();
  });

  it('refuses when another live request on the same book is being imported (shared book row)', async () => {
    loadRequest({ status: 'cancelled' });
    prismaMock.request.count.mockResolvedValue(1);
    expect(await run({ refuseInLibrary: true })).toMatchObject({ success: false, error: 'InLibrary' });
    expect(prismaMock.request.count).toHaveBeenCalledWith({ where: { audiobookId: 'ab-1', status: 'processing', deletedAt: null } });
    expectNoSideEffect();
  });

  it('deletes a never-delivered request whose book holds nothing', async () => {
    loadRequest({ status: 'failed' });
    const result = await run({ refuseInLibrary: true });
    expect(result.success).toBe(true);
    expect(downloadMock.cleanUpRequestDownload).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'req-1' },
      data: expect.objectContaining({ deletedBy: 'admin-1' }),
    }));
  });

  it('an ebook request with an empty placement record is not in the library', async () => {
    loadRequest({ type: 'ebook', placedEbookFiles: [] });
    expect((await run({ refuseInLibrary: true })).success).toBe(true);
  });

  it('a missing request is still NotFound with the option', async () => {
    prismaMock.request.findFirst.mockResolvedValue(null);
    expect(await run({ refuseInLibrary: true })).toMatchObject({ success: false, error: 'NotFound' });
    expect(prismaMock.request.count).not.toHaveBeenCalled();
  });

  it('the single delete (no option) is unchanged: a book in the library is deleted, no import check runs', async () => {
    loadRequest({ status: 'available', book: { filePath: '/media/Made Up Author/Made Up Book', absItemId: 'abs-item-1' } });
    prismaMock.request.count.mockResolvedValue(1);
    filesMock.removeAudiobookFolder.mockResolvedValue({ kind: 'removed', folder: '/media/Made Up Author/Made Up Book' });
    const result = await run();
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(prismaMock.request.count).not.toHaveBeenCalled();
    expect(downloadMock.cleanUpRequestDownload).toHaveBeenCalledTimes(1);
    expect(filesMock.removeAudiobookFolder).toHaveBeenCalledTimes(1);
    expect(filesMock.deleteBackendItem).toHaveBeenCalledTimes(1);
    expect(prismaMock.request.update).toHaveBeenCalledTimes(1);
  });
});
