/**
 * Component: AudioSilo Library Service Tests
 * Documentation: documentation/features/audiosilo-integration.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioSiloLibraryService } from '@/lib/services/library/AudioSiloLibraryService';

const apiMock = vi.hoisted(() => ({
  AudioSiloApiError: class extends Error {
    constructor(message: string, public status: number, public code?: string) {
      super(message);
    }
  },
  rescanAudioSiloBook: vi.fn(),
  audioSiloCoverPath: vi.fn((libraryId: string, relPath: string) => `/cover/${libraryId}/${relPath}`),
  getAudioSiloBooks: vi.fn(),
  getAudioSiloItem: vi.fn(),
  getAudioSiloLibraries: vi.fn(),
  getAudioSiloRecentBooks: vi.fn(),
  getAudioSiloServerInfo: vi.fn(),
  searchAudioSiloBooks: vi.fn(),
  triggerAudioSiloScan: vi.fn(),
}));

const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
  getMany: vi.fn(),
  getBackendMode: vi.fn(),
}));

vi.mock('@/lib/services/audiosilo/api', () => apiMock);
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

function makeBook(overrides: Record<string, unknown> = {}) {
  return {
    id: 1311,
    library_id: 1,
    rel_path: 'Joel Shepherd/Kantovan Vault B01N7DSOR7',
    title: 'Kantovan Vault',
    author: 'Joel Shepherd',
    narrator: 'John Lee',
    asin: 'B01N7DSOR7',
    isbn: null,
    duration: 63108.6,
    added_at: '2026-11-09T05:08:36Z',
    published: '2017-02-21',
    ...overrides,
  };
}

describe('AudioSiloLibraryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.get.mockReset();
    configServiceMock.getMany.mockReset();
  });

  it('maps a book: the library path is the item id, added_at stands in for both dates', async () => {
    apiMock.getAudioSiloBooks.mockResolvedValue([makeBook()]);

    const [item] = await new AudioSiloLibraryService().getLibraryItems('1');

    expect(item.id).toBe('Joel Shepherd/Kantovan Vault B01N7DSOR7');
    expect(item.externalId).toBe(item.id);
    expect(item.title).toBe('Kantovan Vault');
    expect(item.author).toBe('Joel Shepherd');
    expect(item.narrator).toBe('John Lee');
    expect(item.asin).toBe('B01N7DSOR7');
    expect(item.isbn).toBeUndefined();
    expect(item.duration).toBeCloseTo(63108.6);
    expect(item.year).toBe(2017);
    expect(item.addedAt).toEqual(new Date('2026-11-09T05:08:36Z'));
    expect(item.updatedAt).toEqual(item.addedAt);
    expect(item.coverUrl).toBe('/cover/1/Joel Shepherd/Kantovan Vault B01N7DSOR7');
  });

  it('keeps books without an ASIN or author and leaves ebook-only entries out', async () => {
    apiMock.getAudioSiloBooks.mockResolvedValue([
      makeBook({ rel_path: 'no-asin', asin: undefined, author: undefined, published: undefined }),
      makeBook({ rel_path: 'ebook', ebook: true, duration: 0 }),
      makeBook({ rel_path: 'hybrid', ebook: true, duration: 3600 }),
    ]);

    const items = await new AudioSiloLibraryService().getLibraryItems('1');

    expect(items.map((i) => i.id)).toEqual(['no-asin', 'hybrid']);
    expect(items[0].asin).toBeUndefined();
    expect(items[0].author).toBe('');
    expect(items[0].year).toBeUndefined();
  });

  it('lists recent books and search results through the same mapping', async () => {
    apiMock.getAudioSiloRecentBooks.mockResolvedValue([makeBook()]);
    apiMock.searchAudioSiloBooks.mockResolvedValue([makeBook({ rel_path: 'found' })]);
    const service = new AudioSiloLibraryService();

    expect((await service.getRecentlyAdded('1', 10)).map((i) => i.id)).toEqual(['Joel Shepherd/Kantovan Vault B01N7DSOR7']);
    expect((await service.searchItems('1', 'vault')).map((i) => i.id)).toEqual(['found']);
    expect(apiMock.getAudioSiloRecentBooks).toHaveBeenCalledWith('1', 10);
    expect(apiMock.searchAudioSiloBooks).toHaveBeenCalledWith('1', 'vault');
  });

  it('looks a single item up in the configured library by path', async () => {
    configServiceMock.get.mockResolvedValue('1');
    apiMock.getAudioSiloItem.mockResolvedValue(makeBook({ description: 'A long book' }));

    const item = await new AudioSiloLibraryService().getItem('Joel Shepherd/Kantovan Vault B01N7DSOR7');

    expect(apiMock.getAudioSiloItem).toHaveBeenCalledWith('1', 'Joel Shepherd/Kantovan Vault B01N7DSOR7');
    expect(item?.description).toBe('A long book');
  });

  it('returns null for a single item when no library is configured or the lookup fails', async () => {
    configServiceMock.get.mockResolvedValueOnce(null);
    expect(await new AudioSiloLibraryService().getItem('x')).toBeNull();

    configServiceMock.get.mockResolvedValueOnce('1');
    apiMock.getAudioSiloItem.mockRejectedValue(new Error('404'));
    expect(await new AudioSiloLibraryService().getItem('x')).toBeNull();
  });

  it('reports server info with the stable server_id as identifier', async () => {
    apiMock.getAudioSiloServerInfo.mockResolvedValue({ name: 'AudioSilo', version: '2.6.0', server_id: 'srv-1' });
    const service = new AudioSiloLibraryService();

    expect(await service.getServerInfo()).toEqual({ name: 'AudioSilo', version: '2.6.0', identifier: 'srv-1' });
    expect(await service.testConnection()).toEqual({
      success: true,
      serverInfo: { name: 'AudioSilo', version: '2.6.0', identifier: 'srv-1' },
    });
  });

  it('reports a failed connection test with the error text', async () => {
    apiMock.getAudioSiloServerInfo.mockRejectedValue(new Error('AudioSilo not configured'));
    expect(await new AudioSiloLibraryService().testConnection()).toEqual({
      success: false,
      error: 'AudioSilo not configured',
    });
  });

  it('refreshes just the imported book when a path is given', async () => {
    await new AudioSiloLibraryService().triggerLibraryScan('1', 'Author/Title');
    expect(apiMock.rescanAudioSiloBook).toHaveBeenCalledWith('1', 'Author/Title');
    expect(apiMock.triggerAudioSiloScan).not.toHaveBeenCalled();
  });

  it('falls back to one full library scan when AudioSilo has no book at that path', async () => {
    apiMock.rescanAudioSiloBook.mockRejectedValue(new apiMock.AudioSiloApiError('404', 404, 'not_indexable'));
    await new AudioSiloLibraryService().triggerLibraryScan('1', 'Author/New Book');
    expect(apiMock.rescanAudioSiloBook).toHaveBeenCalledTimes(1);
    expect(apiMock.triggerAudioSiloScan).toHaveBeenCalledWith('1');
  });

  it('does not hide other failures behind a full scan', async () => {
    apiMock.rescanAudioSiloBook.mockRejectedValue(new apiMock.AudioSiloApiError('403', 403));
    await expect(new AudioSiloLibraryService().triggerLibraryScan('1', 'Author/Title')).rejects.toThrow('403');
    apiMock.rescanAudioSiloBook.mockRejectedValue(new Error('network down'));
    await expect(new AudioSiloLibraryService().triggerLibraryScan('1', 'Author/Title')).rejects.toThrow('network down');
    expect(apiMock.triggerAudioSiloScan).not.toHaveBeenCalled();
  });

  it('lists libraries with string ids and triggers scans', async () => {
    apiMock.getAudioSiloLibraries.mockResolvedValue([{ id: 1, name: 'Library', kind: 'books' }]);
    const service = new AudioSiloLibraryService();

    expect(await service.getLibraries()).toEqual([{ id: '1', name: 'Library', type: 'books' }]);
    await service.triggerLibraryScan('1');
    expect(apiMock.triggerAudioSiloScan).toHaveBeenCalledWith('1');
  });

  it('gives cover caching the server, key and backend mode', async () => {
    configServiceMock.getMany.mockResolvedValue({
      'audiosilo.server_url': 'http://silo:8080',
      'audiosilo.api_token': 'key-123',
    });
    expect(await new AudioSiloLibraryService().getCoverCachingParams()).toEqual({
      backendBaseUrl: 'http://silo:8080',
      authToken: 'key-123',
      backendMode: 'audiosilo',
    });

    configServiceMock.getMany.mockResolvedValue({ 'audiosilo.server_url': 'http://silo:8080' });
    await expect(new AudioSiloLibraryService().getCoverCachingParams()).rejects.toThrow('incomplete');
  });
});
