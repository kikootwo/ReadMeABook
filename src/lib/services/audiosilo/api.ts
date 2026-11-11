/**
 * Component: AudioSilo API Client
 * Documentation: documentation/features/audiosilo-integration.md
 *
 * Talks to an AudioSilo server (https://audiosilo.app/server) with a personal API key:
 * - libraries and book listing (cursor paged)
 * - search, single book, covers
 * - on-demand library scan
 * Reference: https://docs.audiosilo.app/developers/server/api
 */

import { getConfigService } from '../config.service';
import { RMABLogger } from '@/lib/utils/logger';
import type { AudioSiloBook, AudioSiloLibrary, AudioSiloServerInfo } from './types';

const logger = RMABLogger.create('AudioSilo');

/** AudioSilo caps a page at 200 books (anything larger falls back to 50) */
export const AUDIOSILO_PAGE_SIZE = 200;
const DEFAULT_TIMEOUT_MS = 60_000;

/** An AudioSilo API reply that was not a success; `status` is the HTTP status, `code` AudioSilo's error code when sent. */
export class AudioSiloApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = 'AudioSiloApiError';
  }
}

interface AudioSiloRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
}

export async function getAudioSiloConnection(): Promise<{ baseUrl: string; token: string }> {
  const configService = getConfigService();
  const [serverUrl, token] = await Promise.all([
    configService.get('audiosilo.server_url'),
    configService.get('audiosilo.api_token'),
  ]);
  if (!serverUrl || !token) {
    throw new Error('AudioSilo not configured');
  }
  return { baseUrl: serverUrl.replace(/\/$/, ''), token };
}

/** Make a request to the AudioSilo API (`/api/v1`) and parse the JSON reply (empty replies give {}) */
export async function audioSiloRequest<T>(endpoint: string, options: AudioSiloRequestOptions = {}): Promise<T> {
  const { baseUrl, token } = await getAudioSiloConnection();

  const response = await fetch(`${baseUrl}/api/v1${endpoint}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    let detail = '';
    let code: string | undefined;
    try {
      const err = await response.json();
      detail = err?.error ? ` (${err.error})` : '';
      code = typeof err?.code === 'string' ? err.code : undefined;
    } catch {
      // body was not JSON
    }
    throw new AudioSiloApiError(`AudioSilo API error: ${response.status} ${response.statusText}${detail}`, response.status, code);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function getAudioSiloServerInfo(): Promise<AudioSiloServerInfo> {
  return audioSiloRequest<AudioSiloServerInfo>('/server');
}

/** Audiobook libraries only (podcast libraries are skipped) */
export async function getAudioSiloLibraries(): Promise<AudioSiloLibrary[]> {
  const result = await audioSiloRequest<{ libraries: AudioSiloLibrary[] }>('/libraries');
  return (result.libraries || []).filter((library) => library.kind === 'books');
}

/** Every book in a library, following the cursor until the last page */
export async function getAudioSiloBooks(libraryId: string): Promise<AudioSiloBook[]> {
  const books: AudioSiloBook[] = [];
  let cursor: string | undefined;

  do {
    const query = new URLSearchParams({ limit: String(AUDIOSILO_PAGE_SIZE) });
    if (cursor) query.set('cursor', cursor);
    const page = await audioSiloRequest<{ books?: AudioSiloBook[]; next_cursor?: string }>(
      `/libraries/${encodeURIComponent(libraryId)}/books?${query}`
    );
    books.push(...(page.books || []));
    cursor = page.next_cursor || undefined;
  } while (cursor);

  logger.debug(`Fetched ${books.length} book(s) from AudioSilo library ${libraryId}`);
  return books;
}

/** Newest-first books (one page at most, so `limit` is capped at 200) */
export async function getAudioSiloRecentBooks(libraryId: string, limit: number): Promise<AudioSiloBook[]> {
  const query = new URLSearchParams({
    sort: 'recent',
    limit: String(Math.min(Math.max(limit, 1), AUDIOSILO_PAGE_SIZE)),
  });
  const page = await audioSiloRequest<{ books?: AudioSiloBook[] }>(
    `/libraries/${encodeURIComponent(libraryId)}/books?${query}`
  );
  return page.books || [];
}

/** A single book by its library-relative path (the only key the /item endpoint accepts) */
export async function getAudioSiloItem(libraryId: string, relPath: string): Promise<AudioSiloBook> {
  return audioSiloRequest<AudioSiloBook>(
    `/libraries/${encodeURIComponent(libraryId)}/item?path=${encodeURIComponent(relPath)}`
  );
}

/** Full-text search over title, author, series and narrator; results are limited to one library */
export async function searchAudioSiloBooks(libraryId: string, query: string): Promise<AudioSiloBook[]> {
  const result = await audioSiloRequest<{ books?: AudioSiloBook[] }>(
    `/search?q=${encodeURIComponent(query)}&limit=50`
  );
  return (result.books || []).filter((book) => String(book.library_id) === String(libraryId));
}

/** Ask AudioSilo to rescan a library (admin key required); the scan runs in the background */
export async function triggerAudioSiloScan(libraryId: string): Promise<void> {
  await audioSiloRequest<unknown>(`/admin/libraries/${encodeURIComponent(libraryId)}/scan`, { method: 'POST' });
}

/**
 * Re-read one book (admin key required). Runs at once instead of queueing a library scan.
 * AudioSilo answers 404 `not_indexable` for a path that holds no indexed book (a folder of several books, or a new import).
 */
export async function rescanAudioSiloBook(libraryId: string, relPath: string): Promise<void> {
  await audioSiloRequest<unknown>(
    `/admin/libraries/${encodeURIComponent(libraryId)}/book/rescan?path=${encodeURIComponent(relPath)}`,
    { method: 'POST' }
  );
}

/** Path (relative to the server) of a book's cover image; fetch it with the bearer key */
export function audioSiloCoverPath(libraryId: string, relPath: string, size = 320): string {
  return `/api/v1/libraries/${encodeURIComponent(libraryId)}/cover?path=${encodeURIComponent(relPath)}&size=${size}`;
}
