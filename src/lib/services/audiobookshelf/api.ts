/**
 * Component: Audiobookshelf API Client
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * Provides API methods for interacting with Audiobookshelf:
 * - Library scanning and item fetching
 * - Metadata matching (with ASIN for accurate Audible lookup)
 * - Item management
 */

import { getConfigService } from '../config.service';
import { RMABLogger } from '@/lib/utils/logger';
import { AudibleRegion } from '@/lib/types/audible';

const logger = RMABLogger.create('Audiobookshelf');

/**
 * Map RMAB Audible region to Audiobookshelf provider value
 */
function mapRegionToABSProvider(region: AudibleRegion): string {
  // US uses 'audible' (audible.com), all others use 'audible.{region}'
  return region === 'us' ? 'audible' : `audible.${region}`;
}

/** A non-2xx ABS answer; `status` is the HTTP status. */
export class ABSApiError extends Error {
  constructor(readonly status: number, statusText: string) {
    super(`ABS API error: ${status} ${statusText}`);
  }
}

interface ABSRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  /** Abort the request after this many ms (default: Node fetch's own 300 s headers timeout) */
  timeoutMs?: number;
}

/**
 * Make a request to the Audiobookshelf API
 */
export async function absRequest<T>(endpoint: string, options: ABSRequestOptions = {}): Promise<T> {
  const configService = getConfigService();
  const serverUrl = await configService.get('audiobookshelf.server_url');
  const apiToken = await configService.get('audiobookshelf.api_token');

  if (!serverUrl || !apiToken) {
    throw new Error('Audiobookshelf not configured');
  }

  const url = `${serverUrl.replace(/\/$/, '')}/api${endpoint}`;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
  });

  if (!response.ok) {
    throw new ABSApiError(response.status, response.statusText);
  }

  return response.json();
}

/**
 * Get Audiobookshelf server status/info
 */
export async function getABSServerInfo() {
  return absRequest<{ version: string; name: string }>('/status');
}

/**
 * Get all libraries from Audiobookshelf
 */
export async function getABSLibraries() {
  const result = await absRequest<{ libraries: any[] }>('/libraries');
  return result.libraries;
}

/**
 * Get all items in a library
 */
export async function getABSLibraryItems(libraryId: string) {
  const result = await absRequest<{ results: any[] }>(`/libraries/${libraryId}/items`);
  return result.results;
}

/**
 * Get recently added items in a library
 */
export async function getABSRecentItems(libraryId: string, limit: number) {
  const result = await absRequest<{ results: any[] }>(
    `/libraries/${libraryId}/items?sort=addedAt&desc=1&limit=${limit}`
  );
  return result.results;
}

/**
 * Get a single item by ID
 */
export async function getABSItem(itemId: string) {
  return absRequest<any>(`/items/${itemId}`);
}

/**
 * Search for items in a library
 */
export async function searchABSItems(libraryId: string, query: string) {
  const result = await absRequest<{ book: any[] }>(
    `/libraries/${libraryId}/search?q=${encodeURIComponent(query)}`
  );
  return result.book || [];
}

/**
 * Trigger a library scan
 * Note: This endpoint returns plain text "OK" instead of JSON
 */
export async function triggerABSScan(libraryId: string) {
  const configService = getConfigService();
  const serverUrl = await configService.get('audiobookshelf.server_url');
  const apiToken = await configService.get('audiobookshelf.api_token');

  if (!serverUrl || !apiToken) {
    throw new Error('Audiobookshelf not configured');
  }

  const url = `${serverUrl.replace(/\/$/, '')}/api/libraries/${libraryId}/scan`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`ABS API error: ${response.status} ${response.statusText}`);
  }

  // Endpoint returns plain text "OK", not JSON - don't try to parse it
  await response.text();
}

/**
 * Client-side bound on POST /items/:id/match. ABS answers only after the match is done and saved:
 * up to 3 catalog searches (10 s each) plus parallel Audnexus lookups (10 s each), and fuzzy
 * author validation has no timeout of its own, so about 60 s is a legitimate match. Without this
 * bound Node's fetch would stop at its 300 s headers timeout. If RMAB gives up, nothing is
 * written; ABS may still finish, and the next scan reads its ASIN.
 */
export const ABS_MATCH_TIMEOUT_MS = 180_000;

/** The parts of ABS's library item (toOldJSONExpanded) that the ASIN read-back uses. */
export interface ABSMatchedLibraryItem {
  id?: string;
  media?: { metadata?: { asin?: unknown; isbn?: unknown; [key: string]: unknown } };
}

/**
 * Result of a metadata match. `matched` carries ABS's library item after the match
 * (ASIN at libraryItem.media.metadata.asin, possibly still empty).
 */
export type ABSMatchOutcome =
  | { status: 'matched'; updated: boolean; libraryItem: ABSMatchedLibraryItem | null }
  | { status: 'no_match'; warning: string }
  | { status: 'error'; error: string };

/**
 * Trigger metadata match for a specific library item
 * This tells Audiobookshelf to automatically match and populate metadata from providers.
 * The call is synchronous on the ABS side: the response holds the matched item. Never throws.
 *
 * @param itemId - The Audiobookshelf item ID
 * @param asin - Optional ASIN for direct Audible matching (100% accurate when provided)
 */
export async function triggerABSItemMatch(itemId: string, asin?: string): Promise<ABSMatchOutcome> {
  try {
    // Get configured Audible region to use correct ABS provider
    const configService = getConfigService();
    const region = await configService.getAudibleRegion();
    const provider = mapRegionToABSProvider(region);

    const body: any = {
      provider, // Use region-specific Audible provider (e.g., 'audible.ca' for Canada)
    };

    // If we have an ASIN, we can do a direct match with 100% confidence
    if (asin) {
      body.asin = asin;
      body.overrideDefaults = true; // Override defaults since we have exact ASIN match
    }

    const result = await absRequest<{ warning?: unknown; updated?: boolean; libraryItem?: ABSMatchedLibraryItem }>(`/items/${itemId}/match`, {
      method: 'POST',
      body,
      timeoutMs: ABS_MATCH_TIMEOUT_MS,
    });

    // No match: ABS answers 200 { warning: "No <provider> match found" }
    if (result && typeof result.warning === 'string') {
      return { status: 'no_match', warning: result.warning };
    }

    return { status: 'matched', updated: Boolean(result?.updated), libraryItem: result?.libraryItem ?? null };
  } catch (error) {
    // Don't throw - matching is best-effort, scan should continue even if match fails
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to trigger match for item ${itemId}`, { error: message });
    return { status: 'error', error: message };
  }
}

/** Per-call bound for the tag read and write (#232). */
export const ABS_TAG_TIMEOUT_MS = 15_000;

export type ABSTagWriteResult =
  | { status: 'added'; tags: string[] }
  | { status: 'present' }
  | { status: 'unreadable' }
  | { status: 'failed'; error: string; httpStatus?: number };

const isTagList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((t) => typeof t === 'string');

/**
 * Add tags to an item and keep its others (#232). ABS's PATCH /items/:id/media replaces the whole
 * tags array, so the current list is read first; a list that can't be read is never written.
 * Merged = current (order kept) + missing; PATCH only when something is missing; the response's
 * item must hold every tag. Never throws.
 */
export async function addABSItemTags(itemId: string, tags: string[]): Promise<ABSTagWriteResult> {
  try {
    const item = await absRequest<{ media?: { tags?: unknown } }>(`/items/${itemId}`, { timeoutMs: ABS_TAG_TIMEOUT_MS });
    const current = item?.media?.tags;
    if (!isTagList(current)) {
      logger.warn(`Item ${itemId} has no readable tag list; not writing tags`);
      return { status: 'unreadable' };
    }
    const missing = [...new Set(tags)].filter((t) => !current.includes(t));
    if (missing.length === 0) return { status: 'present' };
    const merged = [...current, ...missing];
    if (!current.every((t) => merged.includes(t))) throw new Error('merged tag list lost an existing tag');

    const result = await absRequest<{ libraryItem?: { media?: { tags?: unknown } } }>(`/items/${itemId}/media`, {
      method: 'PATCH',
      body: { tags: merged },
      timeoutMs: ABS_TAG_TIMEOUT_MS,
    });
    const saved = result?.libraryItem?.media?.tags;
    if (isTagList(saved) && !tags.every((t) => saved.includes(t))) {
      logger.warn(`Item ${itemId}: Audiobookshelf did not keep the tags ${missing.join(', ')}`);
      return { status: 'failed', error: 'tags not saved' };
    }
    return { status: 'added', tags: missing };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', error: message, ...(error instanceof ABSApiError ? { httpStatus: error.status } : {}) };
  }
}

/**
 * Delete a library item from Audiobookshelf.
 * hard: true also deletes the item's files on disk (ABS `?hard=1`); hard: false
 * removes only the item from the ABS database and leaves the files alone.
 *
 * @param itemId - The Audiobookshelf item ID to delete
 */
export async function deleteABSItem(itemId: string, options: { hard: boolean }): Promise<void> {
  const configService = getConfigService();
  const serverUrl = await configService.get('audiobookshelf.server_url');
  const apiToken = await configService.get('audiobookshelf.api_token');

  if (!serverUrl || !apiToken) {
    throw new Error('Audiobookshelf not configured');
  }

  const url = `${serverUrl.replace(/\/$/, '')}/api/items/${itemId}?hard=${options.hard ? 1 : 0}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`ABS API error: ${response.status} ${response.statusText}`);
  }

  logger.info(`Deleted library item ${itemId} from Audiobookshelf (${options.hard ? 'with' : 'without'} its files)`);
}
