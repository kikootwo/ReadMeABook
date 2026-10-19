/**
 * Component: Audiobookshelf API Client
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

interface ABSRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
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
  });

  if (!response.ok) {
    throw new Error(`ABS API error: ${response.status} ${response.statusText}`);
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
 * Trigger metadata match for a specific library item
 * This tells Audiobookshelf to automatically match and populate metadata from providers
 *
 * @param itemId - The Audiobookshelf item ID
 * @param asin - Optional ASIN for direct Audible matching (100% accurate when provided)
 */
export async function triggerABSItemMatch(itemId: string, asin?: string) {
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

    await absRequest(`/items/${itemId}/match`, {
      method: 'POST',
      body,
    });
  } catch (error) {
    // Don't throw - matching is best-effort, scan should continue even if match fails
    logger.error(`Failed to trigger match for item ${itemId}`, { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Format a requester tag from a username.
 * Lowercases, trims, converts spaces to underscores, and strips any character
 * outside [a-z0-9_-]. Example: "John Smith" -> "req:john_smith".
 *
 * Returns '' when the username sanitizes to nothing (e.g. all-symbol or
 * non-Latin usernames). Callers MUST skip empty results — otherwise every such
 * user would collapse onto a single bare `req:` tag, exposing their libraries
 * to each other. The whole point of the tag is per-user scoping.
 *
 * @param username - The requester's username
 * @returns The sanitized `req:<username>` tag, or '' if nothing usable remains
 */
export function formatRequesterTag(username: string): string {
  const sanitized = username
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
  return sanitized ? `req:${sanitized}` : '';
}

/**
 * Add tags to an Audiobookshelf library item, merging with any existing tags.
 * Best-effort: never throws (logs on failure), mirroring triggerABSItemMatch.
 *
 * ABS's PATCH /items/:id/media replaces the entire tags array, so we GET the
 * current media.tags, union with the new tags (dedupe), and PATCH back. This
 * preserves manual tags (e.g. `nsfw`) and other requesters' `req:` tags.
 *
 * @param itemId - The Audiobookshelf item ID
 * @param tagsToAdd - Tags to add to the item
 */
export async function addABSItemTags(itemId: string, tagsToAdd: string[]): Promise<void> {
  try {
    // Drop empty/blank tags defensively — never write a bare/whitespace tag.
    const cleanTags = tagsToAdd.filter((t) => t && t.trim().length > 0);
    if (cleanTags.length === 0) {
      return;
    }

    const item = await getABSItem(itemId);
    const currentTags: string[] = Array.isArray(item?.media?.tags) ? item.media.tags : [];

    const merged = Array.from(new Set([...currentTags, ...cleanTags]));

    // Skip the write if nothing would change
    if (merged.length === currentTags.length) {
      return;
    }

    await absRequest(`/items/${itemId}/media`, {
      method: 'PATCH',
      body: { tags: merged },
    });

    logger.info(`Tagged ABS item ${itemId}`, { added: cleanTags });
  } catch (error) {
    // Don't throw - tagging is best-effort, scan/backfill should continue
    logger.error(`Failed to tag ABS item ${itemId}`, { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Delete a library item from Audiobookshelf
 * Note: This only removes the item from Audiobookshelf's database, not the actual files
 *
 * @param itemId - The Audiobookshelf item ID to delete
 */
export async function deleteABSItem(itemId: string): Promise<void> {
  const configService = getConfigService();
  const serverUrl = await configService.get('audiobookshelf.server_url');
  const apiToken = await configService.get('audiobookshelf.api_token');

  if (!serverUrl || !apiToken) {
    throw new Error('Audiobookshelf not configured');
  }

  const url = `${serverUrl.replace(/\/$/, '')}/api/items/${itemId}?hard=1`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`ABS API error: ${response.status} ${response.statusText}`);
  }

  logger.info(`Deleted library item ${itemId} from Audiobookshelf`);
}
