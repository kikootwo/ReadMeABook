/**
 * Component: Search Indexers Processor Tests
 * Documentation: documentation/backend/services/jobs.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn(), getAudibleRegion: vi.fn().mockResolvedValue('us') }));
const jobQueueMock = createJobQueueMock();
const prowlarrMock = vi.hoisted(() => ({ search: vi.fn(), searchWithVariations: vi.fn() }));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/integrations/prowlarr.service', () => ({
  getProwlarrService: () => prowlarrMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getRuntime: vi.fn().mockResolvedValue(null) }),
}));

describe('processSearchIndexers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.getAudibleRegion.mockResolvedValue('us');
    // Default to empty blocklist so the filter is a no-op unless a test overrides.
    prismaMock.blockedRelease.findMany.mockResolvedValue([]);
  });

  it('marks request awaiting_search when no results found', async () => {
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, categories: [3030] }]);
      }
      return null;
    });
    prowlarrMock.searchWithVariations.mockResolvedValue([]);
    prismaMock.request.update.mockResolvedValue({});

    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
    const result = await processSearchIndexers({
      requestId: 'req-1',
      audiobook: { id: 'a1', title: 'Book', author: 'Author' },
      jobId: 'job-1',
    });

    expect(result.success).toBe(false);
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'awaiting_search' }),
      })
    );
  });

  it('queues download job when results are ranked', async () => {
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, categories: [3030] }]);
      }
      if (key === 'indexer_flag_config') {
        return JSON.stringify([]);
      }
      return null;
    });

    prowlarrMock.searchWithVariations.mockResolvedValue([
      {
        indexer: 'Indexer',
        indexerId: 1,
        title: 'Book - Author',
        size: 50 * 1024 * 1024,
        seeders: 10,
        publishDate: new Date(),
        downloadUrl: 'magnet:?xt=urn:btih:abc',
        guid: 'guid-1',
        format: 'M4B',
      },
    ]);

    prismaMock.request.update.mockResolvedValue({});

    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
    const result = await processSearchIndexers({
      requestId: 'req-2',
      audiobook: { id: 'a2', title: 'Book', author: 'Author' },
      jobId: 'job-2',
    });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith(
      'req-2',
      { id: 'a2', title: 'Book', author: 'Author' },
      expect.objectContaining({ title: 'Book - Author' })
    );
  });

  it('fails when no indexers are configured', async () => {
    configMock.get.mockResolvedValue(null);
    prismaMock.request.update.mockResolvedValue({});

    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
    await expect(
      processSearchIndexers({
        requestId: 'req-3',
        audiobook: { id: 'a3', title: 'Book', author: 'Author' },
        jobId: 'job-3',
      })
    ).rejects.toThrow('No indexers configured');

    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('filters out blocklisted releases by name (case-insensitive) before ranking', async () => {
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, categories: [3030] }]);
      }
      if (key === 'indexer_flag_config') return JSON.stringify([]);
      return null;
    });

    prowlarrMock.searchWithVariations.mockResolvedValue([
      {
        indexer: 'Indexer',
        indexerId: 1,
        title: 'BAD Release - Author',
        size: 50 * 1024 * 1024,
        seeders: 10,
        publishDate: new Date(),
        downloadUrl: 'magnet:?xt=urn:btih:bad',
        guid: 'guid-bad',
        format: 'M4B',
      },
      {
        indexer: 'Indexer',
        indexerId: 1,
        title: 'Good Release - Author',
        size: 50 * 1024 * 1024,
        seeders: 20,
        publishDate: new Date(),
        downloadUrl: 'magnet:?xt=urn:btih:good',
        guid: 'guid-good',
        format: 'M4B',
      },
    ]);

    // Blocklist contains the bad release with lowercased key — must match case-insensitively.
    prismaMock.blockedRelease.findMany.mockResolvedValue([
      { id: 'b1', releaseKey: 'bad release - author', releaseHash: null },
    ]);
    prismaMock.request.update.mockResolvedValue({});

    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
    const result = await processSearchIndexers({
      requestId: 'req-filter-name',
      audiobook: { id: 'a-filter', title: 'Good Release', author: 'Author' },
      jobId: 'job-filter-name',
    });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith(
      'req-filter-name',
      expect.objectContaining({ id: 'a-filter' }),
      expect.objectContaining({ title: 'Good Release - Author' })
    );
  });

  it('filters out blocklisted releases by infoHash even when title differs', async () => {
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, categories: [3030] }]);
      }
      if (key === 'indexer_flag_config') return JSON.stringify([]);
      return null;
    });

    prowlarrMock.searchWithVariations.mockResolvedValue([
      {
        indexer: 'Indexer',
        indexerId: 1,
        title: 'Some Other Title - Author',
        size: 50 * 1024 * 1024,
        seeders: 10,
        publishDate: new Date(),
        downloadUrl: 'magnet:?xt=urn:btih:abc',
        guid: 'guid-hash-bad',
        infoHash: 'abc123',
        format: 'M4B',
      },
      {
        indexer: 'Indexer',
        indexerId: 1,
        title: 'Good Release - Author',
        size: 50 * 1024 * 1024,
        seeders: 20,
        publishDate: new Date(),
        downloadUrl: 'magnet:?xt=urn:btih:def',
        guid: 'guid-hash-good',
        infoHash: 'def456',
        format: 'M4B',
      },
    ]);

    prismaMock.blockedRelease.findMany.mockResolvedValue([
      { id: 'b2', releaseKey: 'unrelated key', releaseHash: 'abc123' },
    ]);
    prismaMock.request.update.mockResolvedValue({});

    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
    const result = await processSearchIndexers({
      requestId: 'req-filter-hash',
      audiobook: { id: 'a-filter-hash', title: 'Good Release', author: 'Author' },
      jobId: 'job-filter-hash',
    });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith(
      'req-filter-hash',
      expect.anything(),
      expect.objectContaining({ title: 'Good Release - Author' })
    );
  });

  it('uses blocklist-exhaustion message when every candidate is blocked', async () => {
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, categories: [3030] }]);
      }
      if (key === 'indexer_flag_config') return JSON.stringify([]);
      return null;
    });

    prowlarrMock.searchWithVariations.mockResolvedValue([
      {
        indexer: 'Indexer',
        indexerId: 1,
        title: 'Bad Release One',
        size: 50 * 1024 * 1024,
        seeders: 10,
        publishDate: new Date(),
        downloadUrl: 'magnet:?xt=urn:btih:1',
        guid: 'g1',
        format: 'M4B',
      },
      {
        indexer: 'Indexer',
        indexerId: 1,
        title: 'Bad Release Two',
        size: 50 * 1024 * 1024,
        seeders: 5,
        publishDate: new Date(),
        downloadUrl: 'magnet:?xt=urn:btih:2',
        guid: 'g2',
        format: 'M4B',
      },
    ]);

    prismaMock.blockedRelease.findMany.mockResolvedValue([
      { id: 'b1', releaseKey: 'bad release one', releaseHash: null },
      { id: 'b2', releaseKey: 'bad release two', releaseHash: null },
    ]);
    prismaMock.request.update.mockResolvedValue({});

    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
    const result = await processSearchIndexers({
      requestId: 'req-exhausted',
      audiobook: { id: 'a-exhausted', title: 'Bad Release', author: 'Author' },
      jobId: 'job-exhausted',
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No usable releases — 2 candidates tried, all blocked/);
    expect(prismaMock.request.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'awaiting_search',
          errorMessage: 'No usable releases — 2 candidates tried, all blocked',
        }),
      })
    );
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });
});


