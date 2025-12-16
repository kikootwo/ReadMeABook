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

export class AudiobookshelfLibraryService implements ILibraryService {

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
    return items.map(this.mapABSItemToLibraryItem);
  }

  async getRecentlyAdded(libraryId: string, limit: number): Promise<LibraryItem[]> {
    const items = await getABSRecentItems(libraryId, limit);
    return items.map(this.mapABSItemToLibraryItem);
  }

  async getItem(itemId: string): Promise<LibraryItem | null> {
    try {
      const item = await getABSItem(itemId);
      return this.mapABSItemToLibraryItem(item);
    } catch {
      return null;
    }
  }

  async searchItems(libraryId: string, query: string): Promise<LibraryItem[]> {
    const items = await searchABSItems(libraryId, query);
    return items.map((result: any) => this.mapABSItemToLibraryItem(result.libraryItem));
  }

  async triggerLibraryScan(libraryId: string): Promise<void> {
    await triggerABSScan(libraryId);
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
