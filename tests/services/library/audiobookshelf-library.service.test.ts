/**
 * Component: Audiobookshelf Library Service Tests
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudiobookshelfLibraryService } from '@/lib/services/library/AudiobookshelfLibraryService';

const apiMock = vi.hoisted(() => ({
  getABSServerInfo: vi.fn(),
  getABSLibraries: vi.fn(),
  getABSLibraryItems: vi.fn(),
  getABSRecentItems: vi.fn(),
  getABSItem: vi.fn(),
  searchABSItems: vi.fn(),
  triggerABSScan: vi.fn(),
}));

const configServiceMock = vi.hoisted(() => ({
  getMany: vi.fn(),
}));

vi.mock('@/lib/services/audiobookshelf/api', () => apiMock);

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

// --- Test data helpers ---

/** Creates a mock ABS item with audio files (audiobook) */
function makeAudiobookItem(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'item-1',
    addedAt: overrides.addedAt ?? 1700000000000,
    updatedAt: overrides.updatedAt ?? 1700000100000,
    ...(overrides.path !== undefined ? { path: overrides.path } : {}),
    ...(overrides.isMissing !== undefined ? { isMissing: overrides.isMissing } : {}),
    media: {
      duration: overrides.duration ?? 3600,
      coverPath: overrides.coverPath ?? '/covers/1.jpg',
      numAudioFiles: overrides.numAudioFiles ?? 1,
      numTracks: overrides.numTracks ?? 1,
      audioFiles: overrides.audioFiles ?? [
        {
          index: 0,
          ino: 'ino-1',
          metadata: { filename: 'chapter01.mp3', ext: '.mp3', path: '/books/chapter01.mp3', size: 5000000, mtimeMs: 1700000000000 },
          duration: 3600,
        },
      ],
      metadata: {
        title: overrides.title ?? 'Audiobook Title',
        authorName: overrides.authorName ?? 'Author',
        narratorName: overrides.narratorName ?? 'Narrator',
        description: overrides.description ?? 'Description',
        asin: overrides.asin ?? 'B00ASIN001',
        isbn: overrides.isbn ?? 'ISBN001',
        publishedYear: overrides.publishedYear ?? '2020',
        genres: overrides.genres ?? [],
        explicit: false,
      },
    },
  };
}

/** Creates a mock ABS item with NO audio files (ebook-only) */
function makeEbookOnlyItem(overrides: Record<string, any> = {}) {
  return {
    id: overrides.id ?? 'ebook-1',
    addedAt: overrides.addedAt ?? 1700000000000,
    updatedAt: overrides.updatedAt ?? 1700000100000,
    media: {
      duration: 0,
      coverPath: overrides.coverPath ?? '/covers/ebook.jpg',
      numAudioFiles: 0,
      numTracks: 0,
      audioFiles: [],
      ebookFile: overrides.ebookFile ?? { ino: 'ino-e1', metadata: { filename: 'book.epub', ext: '.epub' } },
      metadata: {
        title: overrides.title ?? 'Ebook Title',
        authorName: overrides.authorName ?? 'Ebook Author',
        narratorName: undefined,
        description: overrides.description ?? 'Ebook Description',
        asin: overrides.asin ?? 'B00EBOOK01',
        isbn: overrides.isbn ?? 'ISBN-EBOOK',
        publishedYear: overrides.publishedYear ?? '2023',
        genres: overrides.genres ?? [],
        explicit: false,
      },
    },
  };
}

describe('AudiobookshelfLibraryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tests connection and returns server info', async () => {
    apiMock.getABSServerInfo.mockResolvedValue({ name: 'ABS', version: '2.0.0' });

    const service = new AudiobookshelfLibraryService();
    const result = await service.testConnection();

    expect(result.success).toBe(true);
    expect(result.serverInfo).toEqual({
      name: 'ABS',
      version: '2.0.0',
      identifier: 'ABS',
    });
  });

  it('returns errors when server info fails', async () => {
    apiMock.getABSServerInfo.mockRejectedValue(new Error('No connection'));

    const service = new AudiobookshelfLibraryService();
    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.error).toBe('No connection');
  });

  it('filters audiobook libraries only', async () => {
    apiMock.getABSLibraries.mockResolvedValue([
      { id: 'lib-1', name: 'Books', mediaType: 'book', stats: { totalItems: 10 } },
      { id: 'lib-2', name: 'Podcasts', mediaType: 'podcast', stats: { totalItems: 5 } },
    ]);

    const service = new AudiobookshelfLibraryService();
    const libs = await service.getLibraries();

    expect(libs).toEqual([
      { id: 'lib-1', name: 'Books', type: 'book', itemCount: 10 },
    ]);
  });

  it('maps library items to generic fields', async () => {
    apiMock.getABSLibraryItems.mockResolvedValue([
      makeAudiobookItem({
        id: 'item-1',
        title: 'Title',
        authorName: 'Author',
        narratorName: 'Narrator',
        description: 'Desc',
        asin: 'ASIN1',
        isbn: 'ISBN1',
        publishedYear: '2020',
        duration: 3600,
        coverPath: '/covers/1.jpg',
        path: '/audiobooks/Author/Title',
        isMissing: false,
      }),
    ]);

    const service = new AudiobookshelfLibraryService();
    const items = await service.getLibraryItems('lib-1');

    expect(items[0]).toStrictEqual({
      id: 'item-1',
      externalId: 'item-1',
      title: 'Title',
      author: 'Author',
      narrator: 'Narrator',
      description: 'Desc',
      coverUrl: '/api/items/item-1/cover',
      duration: 3600,
      asin: 'ASIN1',
      isbn: 'ISBN1',
      year: 2020,
      addedAt: new Date(1700000000000),
      updatedAt: new Date(1700000100000),
      path: '/audiobooks/Author/Title',
      isMissing: false,
    });
  });

  it('leaves path fields undefined when ABS sends none', async () => {
    apiMock.getABSLibraryItems.mockResolvedValue([makeAudiobookItem({ id: 'item-2' })]);

    const [item] = await new AudiobookshelfLibraryService().getLibraryItems('lib-1');

    expect(item.path).toBeUndefined();
    expect(item.isMissing).toBeUndefined();
  });

  it('returns null when item fetch fails', async () => {
    apiMock.getABSItem.mockRejectedValue(new Error('missing'));

    const service = new AudiobookshelfLibraryService();
    const result = await service.getItem('item-1');

    expect(result).toBeNull();
  });

  it('searches items and maps results', async () => {
    apiMock.searchABSItems.mockResolvedValue([
      {
        libraryItem: makeAudiobookItem({
          id: 'item-2',
          title: 'Search Title',
          authorName: 'Search Author',
          narratorName: '',
          description: '',
          duration: 200,
          coverPath: undefined,
          asin: undefined,
          isbn: undefined,
          publishedYear: undefined,
        }),
      },
    ]);

    const service = new AudiobookshelfLibraryService();
    const items = await service.searchItems('lib-1', 'Search');

    expect(items[0].title).toBe('Search Title');
    expect(items[0].author).toBe('Search Author');
  });

  it('triggers library scans', async () => {
    apiMock.triggerABSScan.mockResolvedValue(undefined);

    const service = new AudiobookshelfLibraryService();
    await service.triggerLibraryScan('lib-1');

    expect(apiMock.triggerABSScan).toHaveBeenCalledWith('lib-1');
  });

  it('returns cover caching params for Audiobookshelf backend', async () => {
    configServiceMock.getMany.mockResolvedValue({
      'audiobookshelf.server_url': 'http://abs:13378',
      'audiobookshelf.api_token': 'abs-token-456',
    });

    const service = new AudiobookshelfLibraryService();
    const params = await service.getCoverCachingParams();

    expect(params).toEqual({
      backendBaseUrl: 'http://abs:13378',
      authToken: 'abs-token-456',
      backendMode: 'audiobookshelf',
    });
  });

  it('throws when getting cover caching params without server URL', async () => {
    configServiceMock.getMany.mockResolvedValue({
      'audiobookshelf.server_url': null,
      'audiobookshelf.api_token': 'token',
    });

    const service = new AudiobookshelfLibraryService();

    await expect(service.getCoverCachingParams()).rejects.toThrow('Audiobookshelf server configuration is incomplete');
  });

  it('throws when getting cover caching params without API token', async () => {
    configServiceMock.getMany.mockResolvedValue({
      'audiobookshelf.server_url': 'http://abs',
      'audiobookshelf.api_token': null,
    });

    const service = new AudiobookshelfLibraryService();

    await expect(service.getCoverCachingParams()).rejects.toThrow('Audiobookshelf server configuration is incomplete');
  });

  // --- Ebook-only filtering tests ---

  describe('ebook-only item filtering', () => {
    it('getLibraryItems excludes ebook-only items (no audio files)', async () => {
      apiMock.getABSLibraryItems.mockResolvedValue([
        makeAudiobookItem({ id: 'audio-1', title: 'Audiobook One' }),
        makeEbookOnlyItem({ id: 'ebook-1', title: 'Ebook One' }),
        makeAudiobookItem({ id: 'audio-2', title: 'Audiobook Two' }),
      ]);

      const service = new AudiobookshelfLibraryService();
      const items = await service.getLibraryItems('lib-1');

      expect(items).toHaveLength(2);
      expect(items.map(i => i.id)).toEqual(['audio-1', 'audio-2']);
    });

    it('getLibraryItems returns empty when all items are ebook-only', async () => {
      apiMock.getABSLibraryItems.mockResolvedValue([
        makeEbookOnlyItem({ id: 'ebook-1' }),
        makeEbookOnlyItem({ id: 'ebook-2' }),
      ]);

      const service = new AudiobookshelfLibraryService();
      const items = await service.getLibraryItems('lib-1');

      expect(items).toHaveLength(0);
    });

    it('getLibraryItems returns all items when none are ebook-only', async () => {
      apiMock.getABSLibraryItems.mockResolvedValue([
        makeAudiobookItem({ id: 'audio-1' }),
        makeAudiobookItem({ id: 'audio-2' }),
        makeAudiobookItem({ id: 'audio-3' }),
      ]);

      const service = new AudiobookshelfLibraryService();
      const items = await service.getLibraryItems('lib-1');

      expect(items).toHaveLength(3);
    });

    it('getRecentlyAdded excludes ebook-only items', async () => {
      apiMock.getABSRecentItems.mockResolvedValue([
        makeEbookOnlyItem({ id: 'ebook-recent' }),
        makeAudiobookItem({ id: 'audio-recent' }),
      ]);

      const service = new AudiobookshelfLibraryService();
      const items = await service.getRecentlyAdded('lib-1', 10);

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('audio-recent');
    });

    it('getItem returns null for ebook-only item', async () => {
      apiMock.getABSItem.mockResolvedValue(
        makeEbookOnlyItem({ id: 'ebook-1' })
      );

      const service = new AudiobookshelfLibraryService();
      const result = await service.getItem('ebook-1');

      expect(result).toBeNull();
    });

    it('getItem returns audiobook item with audio files', async () => {
      apiMock.getABSItem.mockResolvedValue(
        makeAudiobookItem({ id: 'audio-1', title: 'Real Audiobook' })
      );

      const service = new AudiobookshelfLibraryService();
      const result = await service.getItem('audio-1');

      expect(result).not.toBeNull();
      expect(result!.title).toBe('Real Audiobook');
    });

    it('searchItems excludes ebook-only results', async () => {
      apiMock.searchABSItems.mockResolvedValue([
        { libraryItem: makeAudiobookItem({ id: 'audio-match', title: 'Audio Match' }) },
        { libraryItem: makeEbookOnlyItem({ id: 'ebook-match', title: 'Ebook Match' }) },
      ]);

      const service = new AudiobookshelfLibraryService();
      const items = await service.searchItems('lib-1', 'Match');

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Audio Match');
    });

    it('handles items with missing media field gracefully', async () => {
      apiMock.getABSLibraryItems.mockResolvedValue([
        makeAudiobookItem({ id: 'audio-1' }),
        { id: 'broken-1', addedAt: 1700000000000, updatedAt: 1700000000000 }, // no media field at all
      ]);

      const service = new AudiobookshelfLibraryService();
      const items = await service.getLibraryItems('lib-1');

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('audio-1');
    });

    it('handles items with undefined audioFiles gracefully', async () => {
      apiMock.getABSLibraryItems.mockResolvedValue([
        makeAudiobookItem({ id: 'audio-1' }),
        {
          id: 'no-audio-field',
          addedAt: 1700000000000,
          updatedAt: 1700000000000,
          media: {
            duration: 0,
            metadata: { title: 'Broken', authorName: 'Author', genres: [], explicit: false },
            // audioFiles intentionally absent
          },
        },
      ]);

      const service = new AudiobookshelfLibraryService();
      const items = await service.getLibraryItems('lib-1');

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('audio-1');
    });

    it('treats item with both audio files and ebook file as audiobook (passes filter)', async () => {
      // ABS can have items with both audio + ebook (companion ebook)
      const hybridItem = makeAudiobookItem({ id: 'hybrid-1', title: 'Hybrid Item' });
      (hybridItem as any).media.ebookFile = { ino: 'ino-e', metadata: { filename: 'companion.epub' } };

      apiMock.getABSLibraryItems.mockResolvedValue([hybridItem]);

      const service = new AudiobookshelfLibraryService();
      const items = await service.getLibraryItems('lib-1');

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Hybrid Item');
    });

    it('filters using numAudioFiles when audioFiles array is absent (minified list response)', async () => {
      // The ABS list endpoint returns minified media without the audioFiles array
      apiMock.getABSLibraryItems.mockResolvedValue([
        {
          id: 'audiobook-minified',
          addedAt: 1700000000000,
          updatedAt: 1700000100000,
          media: {
            duration: 3600,
            numAudioFiles: 5,
            numTracks: 5,
            coverPath: '/covers/1.jpg',
            // no audioFiles array — minified response
            metadata: {
              title: 'Minified Audiobook',
              authorName: 'Author',
              narratorName: 'Narrator',
              description: 'Desc',
              asin: 'B00MIN001',
              publishedYear: '2021',
              genres: [],
              explicit: false,
            },
          },
        },
        {
          id: 'ebook-minified',
          addedAt: 1700000000000,
          updatedAt: 1700000100000,
          media: {
            duration: 0,
            numAudioFiles: 0,
            numTracks: 0,
            coverPath: '/covers/ebook.jpg',
            ebookFormat: 'epub',
            // no audioFiles array — minified response
            metadata: {
              title: 'Minified Ebook',
              authorName: 'Ebook Author',
              description: 'Ebook Desc',
              asin: 'B00EBOOK02',
              publishedYear: '2023',
              genres: [],
              explicit: false,
            },
          },
        },
      ]);

      const service = new AudiobookshelfLibraryService();
      const items = await service.getLibraryItems('lib-1');

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Minified Audiobook');
    });

    it('falls back to duration check when neither numAudioFiles nor audioFiles exist', async () => {
      apiMock.getABSLibraryItems.mockResolvedValue([
        {
          id: 'audio-duration-only',
          addedAt: 1700000000000,
          updatedAt: 1700000100000,
          media: {
            duration: 7200,
            coverPath: '/covers/1.jpg',
            metadata: {
              title: 'Duration Audiobook',
              authorName: 'Author',
              genres: [],
              explicit: false,
            },
          },
        },
        {
          id: 'ebook-duration-zero',
          addedAt: 1700000000000,
          updatedAt: 1700000100000,
          media: {
            duration: 0,
            coverPath: '/covers/ebook.jpg',
            metadata: {
              title: 'Duration Ebook',
              authorName: 'Author',
              genres: [],
              explicit: false,
            },
          },
        },
      ]);

      const service = new AudiobookshelfLibraryService();
      const items = await service.getLibraryItems('lib-1');

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Duration Audiobook');
    });

    it('assumes audio content when no media fields can determine type', async () => {
      // Safety: if we truly can't tell, don't filter it out
      apiMock.getABSLibraryItems.mockResolvedValue([
        {
          id: 'unknown-1',
          addedAt: 1700000000000,
          updatedAt: 1700000100000,
          media: {
            coverPath: '/covers/1.jpg',
            metadata: {
              title: 'Unknown Media',
              authorName: 'Author',
              genres: [],
              explicit: false,
            },
          },
        },
      ]);

      const service = new AudiobookshelfLibraryService();
      const items = await service.getLibraryItems('lib-1');

      // Should NOT be filtered — we can't determine, so assume audio
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Unknown Media');
    });
  });
});
