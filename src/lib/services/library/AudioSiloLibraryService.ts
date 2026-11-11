/**
 * Component: AudioSilo Library Service
 * Documentation: documentation/features/audiosilo-integration.md
 */

import {
  ILibraryService,
  LibraryConnectionResult,
  ServerInfo,
  Library,
  LibraryItem,
} from './ILibraryService';
import {
  AudioSiloApiError,
  audioSiloCoverPath,
  getAudioSiloBooks,
  getAudioSiloItem,
  getAudioSiloLibraries,
  getAudioSiloRecentBooks,
  getAudioSiloServerInfo,
  rescanAudioSiloBook,
  searchAudioSiloBooks,
  triggerAudioSiloScan,
} from '../audiosilo/api';
import type { AudioSiloBook } from '../audiosilo/types';
import type { BackendMode } from '@/lib/constants/backend-mode';
import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('AudioSiloLibrary');

export class AudioSiloLibraryService implements ILibraryService {
  private configService = getConfigService();

  async testConnection(): Promise<LibraryConnectionResult> {
    try {
      return { success: true, serverInfo: await this.getServerInfo() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getServerInfo(): Promise<ServerInfo> {
    const info = await getAudioSiloServerInfo();
    return {
      name: info.name || 'AudioSilo',
      version: info.version,
      identifier: info.server_id,
    };
  }

  async getLibraries(): Promise<Library[]> {
    const libraries = await getAudioSiloLibraries();
    return libraries.map((library) => ({
      id: String(library.id),
      name: library.name,
      type: library.kind,
    }));
  }

  async getLibraryItems(libraryId: string): Promise<LibraryItem[]> {
    const books = await getAudioSiloBooks(libraryId);
    return books.filter(this.hasAudioContent).map((book) => this.mapBook(book, libraryId));
  }

  async getRecentlyAdded(libraryId: string, limit: number): Promise<LibraryItem[]> {
    const books = await getAudioSiloRecentBooks(libraryId, limit);
    return books.filter(this.hasAudioContent).map((book) => this.mapBook(book, libraryId));
  }

  /** `itemId` is the book's library-relative path, looked up in the configured library */
  async getItem(itemId: string): Promise<LibraryItem | null> {
    try {
      const libraryId = await this.configService.get('audiosilo.library_id');
      if (!libraryId) return null;
      const book = await getAudioSiloItem(libraryId, itemId);
      return this.hasAudioContent(book) ? this.mapBook(book, libraryId) : null;
    } catch {
      return null;
    }
  }

  async searchItems(libraryId: string, query: string): Promise<LibraryItem[]> {
    const books = await searchAudioSiloBooks(libraryId, query);
    return books.filter(this.hasAudioContent).map((book) => this.mapBook(book, libraryId));
  }

  /**
   * With a path, refresh just that book. AudioSilo cannot rescan a folder of several books and does not know a
   * brand-new folder yet (404 `not_indexable`): those fall back to one full, queued library scan.
   */
  async triggerLibraryScan(libraryId: string, path?: string): Promise<void> {
    if (path) {
      try {
        await rescanAudioSiloBook(libraryId, path);
        return;
      } catch (error) {
        if (!(error instanceof AudioSiloApiError) || error.status !== 404) throw error;
        logger.info(`AudioSilo has no indexed book at "${path}" yet; scanning the whole library instead`);
      }
    }
    await triggerAudioSiloScan(libraryId);
  }

  /** Parameters for ThumbnailCacheService.cacheLibraryThumbnail() */
  async getCoverCachingParams(): Promise<{
    backendBaseUrl: string;
    authToken: string;
    backendMode: BackendMode;
  }> {
    const config = await this.configService.getMany(['audiosilo.server_url', 'audiosilo.api_token']);
    const serverUrl = config['audiosilo.server_url'];
    const authToken = config['audiosilo.api_token'];

    if (!serverUrl || !authToken) {
      throw new Error('AudioSilo server configuration is incomplete');
    }

    return { backendBaseUrl: serverUrl, authToken, backendMode: 'audiosilo' };
  }

  /** Ebook-only entries have no audio (AudioSilo marks them `ebook` with no duration) */
  private hasAudioContent(book: AudioSiloBook): boolean {
    if (!book) return false;
    if (book.ebook && !(typeof book.duration === 'number' && book.duration > 0)) return false;
    return true;
  }

  /**
   * AudioSilo has no updated_at, so `added_at` stands in for both dates.
   * The item id is the library-relative path: it is what the /item and /cover endpoints accept.
   */
  private mapBook(book: AudioSiloBook, libraryId: string): LibraryItem {
    const added = book.added_at ? new Date(book.added_at) : new Date(0);
    const published = book.published ? parseInt(book.published.slice(0, 4), 10) : NaN;
    return {
      id: book.rel_path,
      externalId: book.rel_path,
      title: book.title,
      author: book.author || '',
      narrator: book.narrator || undefined,
      description: book.description || undefined,
      coverUrl: audioSiloCoverPath(libraryId, book.rel_path),
      duration: typeof book.duration === 'number' ? book.duration : undefined,
      asin: book.asin || undefined,
      isbn: book.isbn || undefined,
      year: Number.isFinite(published) ? published : undefined,
      addedAt: added,
      updatedAt: added,
    };
  }
}
