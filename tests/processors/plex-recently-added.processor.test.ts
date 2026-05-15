/**
 * Component: Recently Added Processor Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const libraryServiceMock = vi.hoisted(() => ({
  getRecentlyAdded: vi.fn(),
  getCoverCachingParams: vi.fn(),
}));
const configMock = vi.hoisted(() => ({
  getBackendMode: vi.fn(),
  getMany: vi.fn(),
  get: vi.fn(),
}));
const thumbnailCacheServiceMock = vi.hoisted(() => ({
  cacheLibraryThumbnail: vi.fn(),
}));
const jobQueueMock = vi.hoisted(() => ({
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/services/library', () => ({
  getLibraryService: async () => libraryServiceMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/utils/audiobook-matcher', () => ({
  findPlexMatch: vi.fn(),
}));

vi.mock('@/lib/services/audiobookshelf/api', () => ({
  triggerABSItemMatch: vi.fn(),
  getABSItem: vi.fn(),
}));

vi.mock('@/lib/services/thumbnail-cache.service', () => ({
  getThumbnailCacheService: () => thumbnailCacheServiceMock,
}));

describe('processPlexRecentlyAddedCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when Plex configuration is missing', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.getMany.mockResolvedValue({
      plex_url: '',
      plex_token: '',
      plex_audiobook_library_id: '',
    });

    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');
    const result = await processPlexRecentlyAddedCheck({ jobId: 'job-1' });

    expect(result.skipped).toBe(true);
    expect(prismaMock.plexLibrary.findUnique).not.toHaveBeenCalled();
  });

  it('creates and updates recently added library items', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.getMany.mockResolvedValue({
      plex_url: 'http://plex',
      plex_token: 'token',
      plex_audiobook_library_id: 'lib-1',
    });
    configMock.get.mockResolvedValue('lib-1');

    libraryServiceMock.getCoverCachingParams.mockResolvedValue({
      backendBaseUrl: 'http://plex',
      authToken: 'token',
      backendMode: 'plex',
    });

    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue('/app/cache/library/test.jpg');

    libraryServiceMock.getRecentlyAdded.mockResolvedValue([
      {
        id: 'rating-1',
        externalId: 'guid-1',
        title: 'New Item',
        author: 'Author A',
        addedAt: new Date(),
      },
      {
        id: 'rating-2',
        externalId: 'guid-2',
        title: 'Existing Item',
        author: 'Author B',
        addedAt: new Date(),
      },
    ]);

    prismaMock.plexLibrary.findUnique.mockImplementation(async (query: any) => {
      if (query.where.plexGuid === 'guid-2') {
        return { id: 'existing-id', plexGuid: 'guid-2', author: 'Author B' };
      }
      return null;
    });
    prismaMock.plexLibrary.create.mockResolvedValue({});
    prismaMock.plexLibrary.update.mockResolvedValue({});
    prismaMock.request.findMany.mockResolvedValue([]);

    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');
    const result = await processPlexRecentlyAddedCheck({ jobId: 'job-2' });

    expect(result.newCount).toBe(1);
    expect(result.updatedCount).toBe(1);
    expect(prismaMock.plexLibrary.create).toHaveBeenCalled();
    expect(prismaMock.plexLibrary.update).toHaveBeenCalled();
  });

  it('persists durations exceeding INT4 max as BigInt on both create and update paths (regression for #193)', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    configMock.getMany.mockResolvedValue({
      plex_url: 'http://plex',
      plex_token: 'token',
      plex_audiobook_library_id: 'lib-1',
    });
    configMock.get.mockResolvedValue('lib-1');

    libraryServiceMock.getCoverCachingParams.mockResolvedValue({
      backendBaseUrl: 'http://plex',
      authToken: 'token',
      backendMode: 'plex',
    });

    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue(null);

    // Production-observed overflow value: ~4_082_750 seconds → 4_082_750_000 ms (> INT4 max 2_147_483_647)
    const overflowSeconds = 4_082_750;
    const overflowMs = BigInt(overflowSeconds * 1000);

    libraryServiceMock.getRecentlyAdded.mockResolvedValue([
      {
        id: 'rating-new',
        externalId: 'guid-new',
        title: 'Long Audiobook (new)',
        author: 'Author',
        duration: overflowSeconds,
        addedAt: new Date(),
      },
      {
        id: 'rating-existing',
        externalId: 'guid-existing',
        title: 'Long Audiobook (existing)',
        author: 'Author',
        duration: overflowSeconds,
        addedAt: new Date(),
      },
    ]);

    prismaMock.plexLibrary.findUnique.mockImplementation(async (query: any) => {
      if (query.where.plexGuid === 'guid-existing') {
        return { id: 'existing-id', plexGuid: 'guid-existing', author: 'Author', duration: null };
      }
      return null;
    });
    prismaMock.plexLibrary.create.mockResolvedValue({});
    prismaMock.plexLibrary.update.mockResolvedValue({});
    prismaMock.request.findMany.mockResolvedValue([]);

    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');
    await processPlexRecentlyAddedCheck({ jobId: 'job-overflow' });

    expect(prismaMock.plexLibrary.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ duration: overflowMs }),
      })
    );
    expect(prismaMock.plexLibrary.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { plexGuid: 'guid-existing' },
        data: expect.objectContaining({ duration: overflowMs }),
      })
    );
  });

  it('matches requests without re-triggering ABS metadata match for audiobookshelf', async () => {
    const matcher = await import('@/lib/utils/audiobook-matcher');
    const absApi = await import('@/lib/services/audiobookshelf/api');

    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    configMock.getMany.mockResolvedValue({
      'audiobookshelf.server_url': 'http://abs',
      'audiobookshelf.api_token': 'token',
      'audiobookshelf.library_id': 'abs-lib',
    });
    configMock.get.mockResolvedValue('abs-lib');

    libraryServiceMock.getCoverCachingParams.mockResolvedValue({
      backendBaseUrl: 'http://abs',
      authToken: 'token',
      backendMode: 'audiobookshelf',
    });

    thumbnailCacheServiceMock.cacheLibraryThumbnail.mockResolvedValue('/app/cache/library/test.jpg');

    libraryServiceMock.getRecentlyAdded.mockResolvedValue([
      {
        id: 'abs-1',
        externalId: 'abs-item-1',
        title: 'New ABS Item',
        author: 'Author A',
        asin: 'ASIN-ABS', // Item already has ASIN from ABS
        addedAt: new Date(),
      },
    ]);
    prismaMock.plexLibrary.findUnique.mockResolvedValue(null);
    prismaMock.plexLibrary.create.mockResolvedValue({});

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-1',
        status: 'downloaded',
        audiobook: {
          id: 'ab-1',
          title: 'Match Me',
          author: 'Author A',
          narrator: 'Narrator A',
          audibleAsin: 'ASIN-ABS',
        },
        user: {
          plexUsername: 'testuser',
        },
      },
    ] as any);

    (matcher.findPlexMatch as ReturnType<typeof vi.fn>).mockResolvedValue({
      plexGuid: 'abs-item-1',
      plexRatingKey: 'rating-abs',
      title: 'Match Me',
      author: 'Author A',
    });
    prismaMock.audiobook.update.mockResolvedValue({});
    prismaMock.request.update.mockResolvedValue({});

    const { processPlexRecentlyAddedCheck } = await import('@/lib/processors/plex-recently-added.processor');
    const result = await processPlexRecentlyAddedCheck({ jobId: 'job-3' });

    expect(result.matchedDownloads).toBe(1);
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ absItemId: 'abs-item-1' }),
      })
    );
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'available' }),
      })
    );
    // Should NOT trigger metadata match - items already have metadata from ABS
    expect(absApi.triggerABSItemMatch).not.toHaveBeenCalled();
  });
});


