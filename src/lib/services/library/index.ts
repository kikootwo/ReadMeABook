/**
 * Library Service Factory
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { ILibraryService } from './ILibraryService';
import { PlexLibraryService } from './PlexLibraryService';
import { AudiobookshelfLibraryService } from './AudiobookshelfLibraryService';

import { getConfigService } from '@/lib/services/config.service';

let cachedService: ILibraryService | null = null;
let cachedMode: 'plex' | 'audiobookshelf' | null = null;

/**
 * Get the appropriate library service based on backend mode
 * Returns cached instance if mode hasn't changed
 */
export async function getLibraryService(): Promise<ILibraryService> {
  const configService = getConfigService();
  const mode = await configService.getBackendMode();

  // Return cached instance if mode hasn't changed
  if (cachedService && cachedMode === mode) {
    return cachedService;
  }

  // Create new instance based on mode
  if (mode === 'audiobookshelf') {
    cachedService = new AudiobookshelfLibraryService();
  } else {
    cachedService = new PlexLibraryService();
  }

  cachedMode = mode;
  return cachedService;
}

/**
 * Clear cached service instance (useful for testing or mode changes)
 */
export function clearLibraryServiceCache(): void {
  cachedService = null;
  cachedMode = null;
}

// Re-export types
export * from './ILibraryService';
export { PlexLibraryService } from './PlexLibraryService';
export { AudiobookshelfLibraryService } from './AudiobookshelfLibraryService';
