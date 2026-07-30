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
        type: 'audiobook',
      }));
  }

  async getLibraryItems(libraryId: string): Promise<LibraryItem[]> {
    const items = await getABSLibraryItems(libraryId);
    return items
      .filter((item: any) => this.hasAudioContent(item))
      .map((item: any) => this.mapABSItemToLibraryItem(item));
  }

  async getRecentlyAdded(libraryId: string, limit = 20): Promise<LibraryItem[]> {
    const items = await getABSRecentItems(libraryId, limit);
    return items
      .filter((item: any) => this.hasAudioContent(item))
      .map((item: any) => this.mapABSItemToLibraryItem(item));
  }

  async getItem(id: string): Promise<LibraryItem | null> {
    try {
      const item = await getABSItem(id);
      if (!this.hasAudioContent(item)) {
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
   * Filter out non-audio items (ebooks without audio files)
   */
  private hasAudioContent(item: any): boolean {
    if (!item || !item.media) return false;

    // numAudioFiles: present in library item list/search summary objects
    if (typeof item.media.numAudioFiles === 'number') {
      return item.media.numAudioFiles > 0;
    }

    // numTracks: legacy / fallback field in some ABS versions
    if (typeof item.media.numTracks === 'number') {
      return item.media.numTracks > 0;
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

  async verifyItemExists(libraryId: string, title: string): Promise<boolean> {
    try {
      const items = await searchABSItems(libraryId, title);
      if (!Array.isArray(items) || items.length === 0) return false;
      const cleanedQuery = title.toLowerCase().replace(/[^a-z0-9]/g, '');
      return items.some((result: any) => {
        const item = result.libraryItem || result;
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
