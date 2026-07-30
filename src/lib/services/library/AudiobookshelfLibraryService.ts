/**
 * Component: Audiobookshelf Library Service
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import {
  ILibraryService,
  LibraryConnectionResult,
  ServerInfo,
  Library,
  LibraryItem,
} from './ILibraryService';
import {
  getABSServerInfo,
  getABSLibraries,
  getABSLibraryItems,
  getABSRecentItems,
  getABSItem,
  searchABSItems,
  triggerABSScan,
} from '../audiobookshelf/api';
import { ABSLibraryItem } from '../audiobookshelf/types';
import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('AudiobookshelfLibrary');

export class AudiobookshelfLibraryService implements ILibraryService {
  private configService = getConfigService();

  async testConnection(): Promise<LibraryConnectionResult> {
    try {
      const serverInfo = await this.getServerInfo();
      return {
        success: true,
        serverInfo,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async getServerInfo(): Promise<ServerInfo> {
    const info = await getABSServerInfo();
    return {
      name: info.name || 'Audiobookshelf',
      version: info.version,
      identifier: info.name,  // ABS doesn't have unique identifier like Plex
    };
  }

  async getLibraries(): Promise<Library[]> {
    const libraries = await getABSLibraries();
    return libraries
      .filter((lib: any) => lib.mediaType === 'book')  // Only audiobook libraries
      .map((lib: any) => ({
        id: lib.id,
        name: lib.name,
        type: lib.mediaType,
        itemCount: lib.stats?.totalItems,
      }));
  }

  async getLibraryItems(libraryId: string): Promise<LibraryItem[]> {
    const items = await getABSLibraryItems(libraryId);
    const audioItems = items.filter(this.hasAudioContent);
    const skipped = items.length - audioItems.length;
    if (skipped > 0) {
      logger.info(`Filtered ${skipped} ebook-only item(s) from library (no audio files)`);
    }
    return audioItems.map(this.mapABSItemToLibraryItem);
  }

  async getRecentlyAdded(libraryId: string, limit: number): Promise<LibraryItem[]> {
    const items = await getABSRecentItems(libraryId, limit);
    return items.filter(this.hasAudioContent).map(this.mapABSItemToLibraryItem);
  }

  async getItem(itemId: string): Promise<LibraryItem | null> {
    try {
      const item = await getABSItem(itemId);
      if (!this.hasAudioContent(item)) {
        logger.debug(`Item ${itemId} is ebook-only (no audio files), skipping`);
        return null;
      }
      return this.mapABSItemToLibraryItem(item);
    } catch {
      return null;
    }
  }

  async searchItems(libraryId: string, query: string): Promise<LibraryItem[]> {
    const items = await searchABSItems(libraryId, query);
    return items
      .filter((result: any) => this.hasAudioContent(result.libraryItem))
      .map((result: any) => this.mapABSItemToLibraryItem(result.libraryItem));
  }

  async triggerLibraryScan(libraryId: string): Promise<void> {
    await triggerABSScan(libraryId);
  }

  /**
   * Get parameters needed for caching library covers
   * @returns Parameters for ThumbnailCacheService.cacheLibraryThumbnail()
   */
  async getCoverCachingParams(): Promise<{
    backendBaseUrl: string;
    authToken: string;
    backendMode: 'plex' | 'audiobookshelf';
  }> {
    const config = await this.configService.getMany([
      'audiobookshelf.server_url',
      'audiobookshelf.api_token',
    ]);

    const serverUrl = config['audiobookshelf.server_url'];
    const authToken = config['audiobookshelf.api_token'];

    if (!serverUrl || !authToken) {
      throw new Error('Audiobookshelf server configuration is incomplete');
    }

    return {
      backendBaseUrl: serverUrl,
      authToken: authToken,
      backendMode: 'audiobookshelf',
    };
  }

  /**
   * Check if an ABS library item contains audio content.
   * ABS stores both audiobooks and ebooks under mediaType 'book'.
   * Ebook-only items have no audio files and should be excluded from RMAB's audiobook pipeline.
   *
   * The list endpoint returns minified media (numAudioFiles, duration) without the full audioFiles array.
   * The single-item endpoint returns the full audioFiles array.
   * We check all available signals to handle both response shapes.
   */
  private hasAudioContent(item: any): boolean {
    if (!item?.media) return false;

    // numAudioFiles: present in list/search endpoint responses (minified media)
    if (typeof item.media.numAudioFiles === 'number') {
      return item.media.numAudioFiles > 0;
    }

    // audioFiles array: present in full single-item responses
    if (Array.isArray(item.media.audioFiles)) {
      return item.media.audioFiles.length > 0;
    }

    // duration fallback: ebook-only items have 0 duration
    if (typeof item.media.duration === 'number') {
      return item.media.duration > 0;
    }

    // Cannot determine — assume audio content to avoid false filtering
    return true;
  }

  async verifyItemExists(title: string): Promise<boolean> {
    try {
      const items = await searchABSItems(title);
      if (!Array.isArray(items) || items.length === 0) return false;
      const cleanedQuery = title.toLowerCase().replace(/[^a-z0-9]/g, '');
      return items.some((item: any) => {
        const itemTitle = (item.media?.metadata?.title || item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return itemTitle.includes(cleanedQuery) || cleanedQuery.includes(itemTitle);
      });
    } catch {
      return false;
    }
  }

  private mapABSItemToLibraryItem(item: ABSLibraryItem): LibraryItem {
    const metadata = item.media.metadata;
    return {
      id: item.id,
      externalId: item.id,  // ABS item ID is the external ID
      title: metadata.title,
      author: metadata.authorName,
      narrator: metadata.narratorName,
      description: metadata.description,
      coverUrl: item.media.coverPath ? `/api/items/${item.id}/cover` : undefined,
      duration: item.media.duration,
      asin: metadata.asin,
      isbn: metadata.isbn,
      year: metadata.publishedYear ? parseInt(metadata.publishedYear) : undefined,
      addedAt: new Date(item.addedAt),
      updatedAt: new Date(item.updatedAt),
    };
  }
}
