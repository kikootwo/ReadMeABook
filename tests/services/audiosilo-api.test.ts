/**
 * Component: AudioSilo API Client Tests
 * Documentation: documentation/features/audiosilo-integration.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIOSILO_PAGE_SIZE,
  AudioSiloApiError,
  audioSiloCoverPath,
  audioSiloRequest,
  getAudioSiloBooks,
  getAudioSiloItem,
  getAudioSiloLibraries,
  getAudioSiloRecentBooks,
  getAudioSiloServerInfo,
  rescanAudioSiloBook,
  searchAudioSiloBooks,
  triggerAudioSiloScan,
} from '@/lib/services/audiosilo/api';

const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    text: async () => text,
    json: async () => body,
  };
}

function configured() {
  configServiceMock.get.mockImplementation(async (key: string) => {
    if (key === 'audiosilo.server_url') return 'http://silo:8080/';
    if (key === 'audiosilo.api_token') return 'key-123';
    return null;
  });
}

describe('AudioSilo API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.get.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('throws when AudioSilo is not configured', async () => {
    configServiceMock.get.mockResolvedValue(null);
    await expect(audioSiloRequest('/server')).rejects.toThrow('AudioSilo not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls /api/v1 on the configured server with the bearer key', async () => {
    configured();
    fetchMock.mockResolvedValue(jsonResponse({ name: 'AudioSilo', version: '2.6.0', server_id: 'abc' }));

    const info = await getAudioSiloServerInfo();

    expect(info.server_id).toBe('abc');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://silo:8080/api/v1/server');
    expect(options.headers.Authorization).toBe('Bearer key-123');
  });

  it('includes the server message when a request fails', async () => {
    configured();
    fetchMock.mockResolvedValue(jsonResponse({ code: 'not_found', error: 'not found' }, { ok: false, status: 404, statusText: 'Not Found' }));
    await expect(audioSiloRequest('/libraries/9/item')).rejects.toThrow('AudioSilo API error: 404 Not Found (not found)');
  });

  it('throws a typed error carrying the HTTP status and AudioSilo error code', async () => {
    configured();
    fetchMock.mockResolvedValue(jsonResponse({ code: 'not_indexable', error: 'there is no book at that path any more' }, { ok: false, status: 404, statusText: 'Not Found' }));

    const error = await audioSiloRequest('/x').catch((e) => e);

    expect(error).toBeInstanceOf(AudioSiloApiError);
    expect(error.status).toBe(404);
    expect(error.code).toBe('not_indexable');
  });

  it('rescans one book by its encoded path', async () => {
    configured();
    fetchMock.mockResolvedValue(jsonResponse({ book: { title: 'Pandemic' } }));
    await rescanAudioSiloBook('1', 'A. G. Riddle/Pandemic B072NRMT8Q');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://silo:8080/api/v1/admin/libraries/1/book/rescan?path=A.%20G.%20Riddle%2FPandemic%20B072NRMT8Q');
    expect(options.method).toBe('POST');
  });

  it('copes with an empty success reply (scan trigger)', async () => {
    configured();
    fetchMock.mockResolvedValue(jsonResponse(undefined, { status: 202, statusText: 'Accepted' }));
    await expect(triggerAudioSiloScan('1')).resolves.toBeUndefined();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://silo:8080/api/v1/admin/libraries/1/scan');
    expect(options.method).toBe('POST');
  });

  it('lists audiobook libraries only', async () => {
    configured();
    fetchMock.mockResolvedValue(jsonResponse({
      libraries: [
        { id: 1, name: 'Books', kind: 'books' },
        { id: 2, name: 'Shows', kind: 'podcasts' },
      ],
    }));
    const libraries = await getAudioSiloLibraries();
    expect(libraries.map((l) => l.id)).toEqual([1]);
  });

  it('follows next_cursor until the last page', async () => {
    configured();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ books: [{ rel_path: 'a' }, { rel_path: 'b' }], next_cursor: 'c1' }))
      .mockResolvedValueOnce(jsonResponse({ books: [{ rel_path: 'c' }], next_cursor: 'c2' }))
      .mockResolvedValueOnce(jsonResponse({ books: [{ rel_path: 'd' }] }));

    const books = await getAudioSiloBooks('1');

    expect(books.map((b) => b.rel_path)).toEqual(['a', 'b', 'c', 'd']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://silo:8080/api/v1/libraries/1/books?limit=${AUDIOSILO_PAGE_SIZE}`);
    expect(fetchMock.mock.calls[1][0]).toContain('cursor=c1');
    expect(fetchMock.mock.calls[2][0]).toContain('cursor=c2');
  });

  it('asks for the newest books first and caps the page size', async () => {
    configured();
    fetchMock.mockResolvedValue(jsonResponse({ books: [] }));
    await getAudioSiloRecentBooks('1', 10);
    await getAudioSiloRecentBooks('1', 5000);
    expect(fetchMock.mock.calls[0][0]).toBe('http://silo:8080/api/v1/libraries/1/books?sort=recent&limit=10');
    expect(fetchMock.mock.calls[1][0]).toBe(`http://silo:8080/api/v1/libraries/1/books?sort=recent&limit=${AUDIOSILO_PAGE_SIZE}`);
  });

  it('fetches one book by its encoded library path', async () => {
    configured();
    fetchMock.mockResolvedValue(jsonResponse({ rel_path: 'Joel Shepherd/Kantovan Vault B01N7DSOR7', title: 'Kantovan Vault' }));
    const book = await getAudioSiloItem('1', 'Joel Shepherd/Kantovan Vault B01N7DSOR7');
    expect(book.title).toBe('Kantovan Vault');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://silo:8080/api/v1/libraries/1/item?path=Joel%20Shepherd%2FKantovan%20Vault%20B01N7DSOR7'
    );
  });

  it('searches and keeps only books of the requested library', async () => {
    configured();
    fetchMock.mockResolvedValue(jsonResponse({
      books: [
        { rel_path: 'x', library_id: 1, title: 'In library' },
        { rel_path: 'y', library_id: 2, title: 'Elsewhere' },
      ],
    }));
    const books = await searchAudioSiloBooks('1', 'grunt life');
    expect(books.map((b) => b.title)).toEqual(['In library']);
    expect(fetchMock.mock.calls[0][0]).toBe('http://silo:8080/api/v1/search?q=grunt%20life&limit=50');
  });

  it('builds the cover path from the library path (the id is not accepted)', () => {
    expect(audioSiloCoverPath('1', 'A B/C', 160)).toBe('/api/v1/libraries/1/cover?path=A%20B%2FC&size=160');
    expect(audioSiloCoverPath('1', 'A')).toContain('size=320');
  });
});
