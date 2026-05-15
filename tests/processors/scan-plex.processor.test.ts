/**
 * Component: Library Scan Processor Tests
 * Documentation: documentation/backend/services/jobs.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const libraryServiceMock = vi.hoisted(() => ({
  getLibraryItems: vi.fn(),
  getCoverCachingParams: vi.fn(),
}));
const configMock = vi.hoisted(() => ({
  getBackendMode: vi.fn(),
  getPlexConfig: vi.fn(),
  get: vi.fn(),
}));
const thumbnailCacheServiceMock = vi.hoisted(() => ({
  cacheLibraryThumbnail: vi.fn(),
}));
const jobQueueMock = vi.hoisted(() => ({
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/utils/audiobook-matcher', () => ({
  findPlexMatch: vi.fn(),
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/services/audiobookshelf/api', () => ({
  triggerABSItemMatch: vi.fn(),
  getABSItem: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/library', () => ({
  getLibraryService: () => libraryServiceMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/thumbnail-cache.service', () => ({
  getThumbnailCacheService: () => thumbnailCacheServiceMock,
}));

describe('processScanPlex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates and updates library items, matches requests', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.getPlexConfig.mockResolvedValue({
      serverUrl: 'http://plex',
      authToken: 'token',
      libraryId: 'lib-1',
      machineIdentifier: 'machine',
    });

    libraryServiceMock.getCoverCachingParams.mockResolvedValue({
      backendBaseUrl: 'http://plex',
      authToken: 'token',
      backendMode: 'plex',
    });

    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue('/app/cache/library/test.jpg');

    libraryServiceMock.getLibraryItems.mockResolvedValue([
      {
        id: 'rating-1',
        externalId: 'guid-1',
        title: 'New Book',
        author: 'Author',
        addedAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'rating-2',
        externalId: 'guid-2',
        title: 'Existing Book',
        author: 'Author',
        addedAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    prismaMock.plexLibrary.findFirst.mockImplementation(async (query: any) => {
      if (query.where.plexGuid === 'guid-2') {
        return { id: 'existing-id', plexGuid: 'guid-2' };
      }
      return null;
    });
    prismaMock.plexLibrary.create.mockResolvedValue({ id: 'new-id', plexGuid: 'guid-1' });
    prismaMock.plexLibrary.update.mockResolvedValue({});
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.audiobook.findMany.mockResolvedValue([]);
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-1',
        status: 'downloaded',
        audiobook: {
          id: 'a1',
          title: 'New Book',
          author: 'Author',
          narrator: null,
          audibleAsin: 'ASIN1',
        },
      },
    ]);
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.request.update.mockResolvedValue({});

    const matcher = await import('@/lib/utils/audiobook-matcher');
    vi.spyOn(matcher, 'findPlexMatch').mockResolvedValue({
      plexGuid: 'guid-1',
      plexRatingKey: 'rating-1',
      title: 'New Book',
      author: 'Author',
    });

    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    const result = await processScanPlex({ jobId: 'job-1' });

    expect(result.success).toBe(true);
    expect(prismaMock.plexLibrary.create).toHaveBeenCalled();
    expect(prismaMock.plexLibrary.update).toHaveBeenCalled();
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'available' }),
      })
    );
  });

  it('persists durations exceeding INT4 max as BigInt on both create and update paths (regression for #193)', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.getPlexConfig.mockResolvedValue({
      serverUrl: 'http://plex',
      authToken: 'token',
      libraryId: 'lib-1',
      machineIdentifier: 'machine',
    });

    libraryServiceMock.getCoverCachingParams.mockResolvedValue({
      backendBaseUrl: 'http://plex',
      authToken: 'token',
      backendMode: 'plex',
    });

    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue(null);

    // Production-observed overflow value: ~4_082_750 seconds → 4_082_750_000 ms (> INT4 max 2_147_483_647)
    const overflowSeconds = 4_082_750;
    const overflowMs = BigInt(overflowSeconds * 1000);

    libraryServiceMock.getLibraryItems.mockResolvedValue([
      {
        id: 'rating-new',
        externalId: 'guid-new',
        title: 'Long Audiobook (new)',
        author: 'Author',
        duration: overflowSeconds,
        addedAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'rating-existing',
        externalId: 'guid-existing',
        title: 'Long Audiobook (existing)',
        author: 'Author',
        duration: overflowSeconds,
        addedAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    prismaMock.plexLibrary.findFirst.mockImplementation(async (query: any) => {
      if (query.where.plexGuid === 'guid-existing') {
        return { id: 'existing-id', plexGuid: 'guid-existing', author: 'Author', duration: null };
      }
      return null;
    });
    prismaMock.plexLibrary.create.mockResolvedValue({ id: 'new-id', plexGuid: 'guid-new' });
    prismaMock.plexLibrary.update.mockResolvedValue({});
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.audiobook.findMany.mockResolvedValue([]);
    prismaMock.request.findMany.mockResolvedValue([]);

    const matcher = await import('@/lib/utils/audiobook-matcher');
    (matcher.findPlexMatch as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    await processScanPlex({ jobId: 'job-overflow' });

    expect(prismaMock.plexLibrary.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ duration: overflowMs }),
      })
    );
    expect(prismaMock.plexLibrary.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'existing-id' },
        data: expect.objectContaining({ duration: overflowMs }),
      })
    );
  });

  it('throws when audiobookshelf library is not configured', async () => {
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.get.mockResolvedValue(null);

    libraryServiceMock.getCoverCachingParams.mockResolvedValue({
      backendBaseUrl: 'http://abs',
      authToken: 'token',
      backendMode: 'audiobookshelf',
    });

    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');

    await expect(processScanPlex({ jobId: 'job-2' })).rejects.toThrow(
      'Audiobookshelf library not configured'
    );
    expect(libraryServiceMock.getLibraryItems).not.toHaveBeenCalled();
  });

  it('removes stale items and resets linked audiobooks and requests', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.getPlexConfig.mockResolvedValue({
      serverUrl: 'http://plex',
      authToken: 'token',
      libraryId: 'lib-1',
      machineIdentifier: 'machine',
    });

    libraryServiceMock.getCoverCachingParams.mockResolvedValue({
      backendBaseUrl: 'http://plex',
      authToken: 'token',
      backendMode: 'plex',
    });

    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue('/app/cache/library/test.jpg');

    libraryServiceMock.getLibraryItems.mockResolvedValue([
      {
        id: 'rating-1',
        externalId: 'guid-1',
        title: 'Current Book',
        author: 'Author',
        addedAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    prismaMock.plexLibrary.findFirst.mockResolvedValue(null);
    prismaMock.plexLibrary.create.mockResolvedValue({ id: 'new-id', plexGuid: 'guid-1' });
    prismaMock.plexLibrary.findMany
      .mockResolvedValueOnce([{ id: 'stale-1', plexGuid: 'stale-guid', title: 'Stale Book' }])
      .mockResolvedValueOnce([{ plexGuid: 'guid-1' }]);
    prismaMock.plexLibrary.delete.mockResolvedValue({});
    prismaMock.audiobook.findMany
      .mockResolvedValueOnce([
        {
          id: 'ab-1',
          title: 'Stale Book',
          requests: [{ id: 'req-1', status: 'available' }],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'ab-valid',
          title: 'Valid Book',
          plexGuid: 'guid-1',
          absItemId: null,
          requests: [],
        },
        {
          id: 'ab-orphan',
          title: 'Orphaned Book',
          plexGuid: null,
          absItemId: 'missing-guid',
          requests: [{ id: 'req-2', status: 'available' }],
        },
      ]);
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.request.findMany.mockResolvedValue([]);

    const matcher = await import('@/lib/utils/audiobook-matcher');
    (matcher.findPlexMatch as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    const result = await processScanPlex({ jobId: 'job-3' });

    expect(result.success).toBe(true);
    expect(prismaMock.plexLibrary.delete).toHaveBeenCalledWith({ where: { id: 'stale-1' } });
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ab-orphan' },
        data: expect.objectContaining({ plexGuid: null, absItemId: null }),
      })
    );
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'downloaded' }),
      })
    );
  });

  it('matches audiobookshelf requests without re-triggering metadata match', async () => {
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.get.mockResolvedValue('abs-lib');

    libraryServiceMock.getCoverCachingParams.mockResolvedValue({
      backendBaseUrl: 'http://abs',
      authToken: 'token',
      backendMode: 'audiobookshelf',
    });

    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue('/app/cache/library/test.jpg');

    libraryServiceMock.getLibraryItems.mockResolvedValue([]);

    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.audiobook.findMany.mockResolvedValue([]);
    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-abs',
        status: 'downloaded',
        audiobook: {
          id: 'abs-audio',
          title: 'ABS Title',
          author: 'ABS Author',
          narrator: 'Narrator',
          audibleAsin: 'ASIN123',
        },
        user: {
          plexUsername: 'testuser',
        },
      },
    ] as any);
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.request.update.mockResolvedValue({});

    const matcher = await import('@/lib/utils/audiobook-matcher');
    (matcher.findPlexMatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      plexGuid: 'abs-item-1',
      plexRatingKey: 'rating-abs',
      title: 'ABS Title',
      author: 'ABS Author',
    });

    const absApi = await import('@/lib/services/audiobookshelf/api');

    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    const result = await processScanPlex({ jobId: 'job-4' });

    expect(result.success).toBe(true);
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ absItemId: 'abs-item-1' }),
      })
    );
    // Should NOT trigger metadata match - items with ASIN already have correct metadata
    expect(absApi.triggerABSItemMatch).not.toHaveBeenCalled();
  });

  it('uses file hash matching for ABS items without ASIN', async () => {
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.get.mockResolvedValue('abs-lib');

    libraryServiceMock.getCoverCachingParams.mockResolvedValue({
      backendBaseUrl: 'http://abs',
      authToken: 'token',
      backendMode: 'audiobookshelf',
    });

    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue('/app/cache/library/test.jpg');

    // Return an item without ASIN
    libraryServiceMock.getLibraryItems.mockResolvedValue([
      {
        id: 'rating-hash-1',
        externalId: 'abs-hash-1',
        title: 'Book Without ASIN',
        author: 'Author',
        asin: null, // No ASIN yet
        addedAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    prismaMock.plexLibrary.findFirst.mockResolvedValue(null);
    prismaMock.plexLibrary.create.mockResolvedValue({});
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.audiobook.findMany.mockResolvedValue([]);
    prismaMock.request.findMany.mockResolvedValue([]);

    // Mock getABSItem to return item with audio files
    const absApi = await import('@/lib/services/audiobookshelf/api');
    (absApi.getABSItem as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'abs-hash-1',
      media: {
        audioFiles: [
          { metadata: { filename: 'Chapter 01.mp3' } },
          { metadata: { filename: 'Chapter 02.mp3' } },
          { metadata: { filename: 'Chapter 03.mp3' } },
        ],
      },
    });

    // Mock findFirst to return matching audiobook with filesHash
    prismaMock.audiobook.findFirst.mockResolvedValue({
      id: 'matched-audio-1',
      audibleAsin: 'MATCHED-ASIN',
      title: 'Matched Book Title',
      status: 'completed',
    } as any);

    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    const result = await processScanPlex({ jobId: 'job-hash-1' });

    expect(result.success).toBe(true);

    // Verify getABSItem was called
    expect(absApi.getABSItem).toHaveBeenCalledWith('abs-hash-1');

    // Verify audiobook.findFirst was called with hash matching
    expect(prismaMock.audiobook.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          filesHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          status: 'completed',
        }),
      })
    );

    // Verify triggerABSItemMatch was called with matched ASIN
    expect(absApi.triggerABSItemMatch).toHaveBeenCalledWith('abs-hash-1', 'MATCHED-ASIN');
  });

  it('falls back to fuzzy matching when no file hash match found', async () => {
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.get.mockResolvedValue('abs-lib');

    libraryServiceMock.getCoverCachingParams.mockResolvedValue({
      backendBaseUrl: 'http://abs',
      authToken: 'token',
      backendMode: 'audiobookshelf',
    });

    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue('/app/cache/library/test.jpg');

    // Return an item without ASIN
    libraryServiceMock.getLibraryItems.mockResolvedValue([
      {
        id: 'rating-fuzzy-1',
        externalId: 'abs-fuzzy-1',
        title: 'External Book',
        author: 'Author',
        asin: null,
        addedAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    prismaMock.plexLibrary.findFirst.mockResolvedValue(null);
    prismaMock.plexLibrary.create.mockResolvedValue({});
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.audiobook.findMany.mockResolvedValue([]);
    prismaMock.request.findMany.mockResolvedValue([]);

    // Mock getABSItem to return item with audio files
    const absApi = await import('@/lib/services/audiobookshelf/api');
    (absApi.getABSItem as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'abs-fuzzy-1',
      media: {
        audioFiles: [{ metadata: { filename: 'Some File.mp3' } }],
      },
    });

    // Mock findFirst to return NO match (external content)
    prismaMock.audiobook.findFirst.mockResolvedValue(null);

    const { processScanPlex } = await import('@/lib/processors/scan-plex.processor');
    const result = await processScanPlex({ jobId: 'job-fuzzy-1' });

    expect(result.success).toBe(true);

    // Verify triggerABSItemMatch was called WITHOUT ASIN (fuzzy fallback)
    expect(absApi.triggerABSItemMatch).toHaveBeenCalledWith('abs-fuzzy-1', undefined);
  });
});


