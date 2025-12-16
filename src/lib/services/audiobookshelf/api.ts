/**
 * Component: Audiobookshelf API Client
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { getConfigService } from '../config.service';

interface ABSRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
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
 */
export async function triggerABSScan(libraryId: string) {
  await absRequest(`/libraries/${libraryId}/scan`, { method: 'POST' });
}
