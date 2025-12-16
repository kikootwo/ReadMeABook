/**
 * Plex Library Service Implementation
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import {
  ILibraryService,
  ServerInfo,
  Library,
  LibraryItem,
  LibraryConnectionResult,
} from './ILibraryService';
import { getPlexService } from '@/lib/integrations/plex.service';
import { getConfigService } from '@/lib/services/config.service';

export class PlexLibraryService implements ILibraryService {
  private plexService = getPlexService();
  private configService = getConfigService();

  /**
   * Test connection to Plex server
   */
  async testConnection(): Promise<LibraryConnectionResult> {
    try {
      const config = await this.configService.getPlexConfig();

      if (!config.serverUrl || !config.authToken) {
        return {
          success: false,
          error: 'Plex server configuration is incomplete',
        };
      }

      const result = await this.plexService.testConnection(
        config.serverUrl,
        config.authToken
      );

      if (!result.success) {
        return {
          success: false,
          error: result.message,
        };
      }

      return {
        success: true,
        serverInfo: result.info ? {
          name: result.info.platform || 'Plex Media Server',
          version: result.info.version,
          platform: result.info.platform,
          identifier: result.info.machineIdentifier,
        } : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Get Plex server information
   */
  async getServerInfo(): Promise<ServerInfo> {
    const config = await this.configService.getPlexConfig();

    if (!config.serverUrl || !config.authToken) {
      throw new Error('Plex server configuration is incomplete');
    }

    const result = await this.plexService.testConnection(
      config.serverUrl,
      config.authToken
    );

    if (!result.success || !result.info) {
      throw new Error('Failed to get server information');
    }

    return {
      name: result.info.platform || 'Plex Media Server',
      version: result.info.version,
      platform: result.info.platform,
      identifier: result.info.machineIdentifier,
    };
  }

  /**
   * Get all libraries from Plex server
   */
  async getLibraries(): Promise<Library[]> {
    const config = await this.configService.getPlexConfig();

    if (!config.serverUrl || !config.authToken) {
      throw new Error('Plex server configuration is incomplete');
    }

    const libraries = await this.plexService.getLibraries(
      config.serverUrl,
      config.authToken
    );

    return libraries.map(lib => ({
      id: lib.id,
      name: lib.title,
      type: lib.type,
      itemCount: lib.itemCount,
    }));
  }

  /**
   * Get all items from a library
   */
  async getLibraryItems(libraryId: string): Promise<LibraryItem[]> {
    const config = await this.configService.getPlexConfig();

    if (!config.serverUrl || !config.authToken) {
      throw new Error('Plex server configuration is incomplete');
    }

    const items = await this.plexService.getLibraryContent(
      config.serverUrl,
      config.authToken,
      libraryId
    );

    return items.map(item => this.mapPlexItemToLibraryItem(item));
  }

  /**
   * Get recently added items from a library
   */
  async getRecentlyAdded(libraryId: string, limit: number): Promise<LibraryItem[]> {
    const config = await this.configService.getPlexConfig();

    if (!config.serverUrl || !config.authToken) {
      throw new Error('Plex server configuration is incomplete');
    }

    const items = await this.plexService.getRecentlyAdded(
      config.serverUrl,
      config.authToken,
      libraryId,
      limit
    );

    return items.map(item => this.mapPlexItemToLibraryItem(item));
  }

  /**
   * Get a single item by its rating key
   */
  async getItem(itemId: string): Promise<LibraryItem | null> {
    const config = await this.configService.getPlexConfig();

    if (!config.serverUrl || !config.authToken) {
      throw new Error('Plex server configuration is incomplete');
    }

    try {
      const metadata = await this.plexService.getItemMetadata(
        config.serverUrl,
        config.authToken,
        itemId
      );

      if (!metadata) {
        return null;
      }

      // Note: getItemMetadata only returns partial data (userRating)
      // For full item data, we would need to fetch from library content
      // This is a simplified implementation
      return null;
    } catch (error) {
      console.error('[PlexLibraryService] Failed to get item:', error);
      return null;
    }
  }

  /**
   * Search library for items matching query
   */
  async searchItems(libraryId: string, query: string): Promise<LibraryItem[]> {
    const config = await this.configService.getPlexConfig();

    if (!config.serverUrl || !config.authToken) {
      throw new Error('Plex server configuration is incomplete');
    }

    const items = await this.plexService.searchLibrary(
      config.serverUrl,
      config.authToken,
      libraryId,
      query
    );

    return items.map(item => this.mapPlexItemToLibraryItem(item));
  }

  /**
   * Trigger library scan
   */
  async triggerLibraryScan(libraryId: string): Promise<void> {
    const config = await this.configService.getPlexConfig();

    if (!config.serverUrl || !config.authToken) {
      throw new Error('Plex server configuration is incomplete');
    }

    await this.plexService.scanLibrary(
      config.serverUrl,
      config.authToken,
      libraryId
    );
  }

  /**
   * Map Plex audiobook to generic LibraryItem interface
   */
  private mapPlexItemToLibraryItem(plexItem: any): LibraryItem {
    // Extract ASIN from plexGuid if present
    const asin = this.extractAsinFromGuid(plexItem.guid);

    return {
      id: plexItem.ratingKey,
      externalId: plexItem.guid,
      title: plexItem.title,
      author: plexItem.author || '',
      narrator: plexItem.narrator,
      description: plexItem.summary,
      coverUrl: plexItem.thumb,
      duration: plexItem.duration ? Math.floor(plexItem.duration / 1000) : undefined, // Convert ms to seconds
      asin,
      isbn: undefined, // Plex doesn't typically store ISBN
      year: plexItem.year,
      addedAt: new Date(plexItem.addedAt * 1000), // Convert Unix timestamp to Date
      updatedAt: new Date(plexItem.updatedAt * 1000),
    };
  }

  /**
   * Extract ASIN from Plex GUID
   * Plex GUIDs can contain ASIN in formats like:
   * - com.plexapp.agents.audible://B00ABC123?lang=en
   * - plex://album/5d07bcfe403c64002036d1af
   */
  private extractAsinFromGuid(guid: string): string | undefined {
    if (!guid) return undefined;

    // Match ASIN pattern in Audible agent GUIDs
    const asinMatch = guid.match(/audible:\/\/([A-Z0-9]{10})/i);
    if (asinMatch && asinMatch[1]) {
      return asinMatch[1];
    }

    return undefined;
  }
}
