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
    // An active request: the stop guard's conditional status writes match one row
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
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
    expect(prismaMock.request.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'req-1', deletedAt: null, status: { not: 'cancelled' } },
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
      {
        indexer: 'Fallback Indexer',
        indexerId: 2,
        title: 'Book - Author - Alternate',
        size: 50 * 1024 * 1024,
        seeders: 1,
        publishDate: new Date(),
        downloadUrl: 'https://prowlarr/2/download/alternate',
        guid: 'guid-2',
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
      expect.objectContaining({ title: 'Book - Author' }),
      [expect.objectContaining({ title: 'Book - Author - Alternate' })]
    );
    expect(prowlarrMock.searchWithVariations).toHaveBeenCalledWith('Book', 'Author', {
      categories: [3030],
      indexerIds: [1],
      minSeeders: 1,
    });
  });

  it('ranks all candidates before limiting automatic search to 100 results', async () => {
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, categories: [3030] }]);
      }
      if (key === 'indexer_flag_config') return JSON.stringify([]);
      return null;
    });

    const candidates = Array.from({ length: 101 }, (_, index) => ({
      indexer: 'Indexer',
      indexerId: 1,
      title: 'Book - Author',
      size: 50 * 1024 * 1024,
      seeders: index === 100 ? 500 : 1,
      publishDate: new Date(),
      downloadUrl: `magnet:?xt=urn:btih:${index}`,
      guid: `guid-${index}`,
      format: 'M4B',
    }));
    prowlarrMock.searchWithVariations.mockResolvedValue(candidates);
    prismaMock.request.update.mockResolvedValue({});

    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
    const result = await processSearchIndexers({
      requestId: 'req-rank-before-limit',
      audiobook: { id: 'a-rank-before-limit', title: 'Book', author: 'Author' },
      jobId: 'job-rank-before-limit',
    });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith(
      'req-rank-before-limit',
      expect.anything(),
      expect.objectContaining({ guid: 'guid-100' }),
      expect.any(Array)
    );
    const fallbackResults = jobQueueMock.addDownloadJob.mock.calls[0][3];
    expect(fallbackResults).toHaveLength(99);
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

    expect(prismaMock.request.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'req-3', deletedAt: null, status: { not: 'cancelled' } },
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('skips the search for a request cancelled or deleted before the job ran', async () => {
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });

    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
    const result = await processSearchIndexers({
      requestId: 'req-c',
      audiobook: { id: 'a-c', title: 'Book', author: 'Author' },
      jobId: 'job-c',
    }).catch((error: unknown) => error); // on main the search runs on and errors

    // Main overwrote the cancel with a plain 'searching' write and searched
    expect(prismaMock.request.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, requestId: 'req-c' });
    expect(prismaMock.request.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'req-c', deletedAt: null, status: { not: 'cancelled' } },
      data: expect.objectContaining({ status: 'searching' }),
    }));
    expect(prowlarrMock.searchWithVariations).not.toHaveBeenCalled();
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('leaves a cancel that lands during a failed search in place', async () => {
    configMock.get.mockResolvedValue(null);
    // The 'searching' claim matches; the 'failed' write matches nothing (cancelled meanwhile)
    prismaMock.request.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
    await expect(processSearchIndexers({
      requestId: 'req-r',
      audiobook: { id: 'a-r', title: 'Book', author: 'Author' },
      jobId: 'job-r',
    })).rejects.toThrow('No indexers configured');

    expect(prismaMock.request.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
    expect(prismaMock.request.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'req-r', deletedAt: null, status: { not: 'cancelled' } },
      data: expect.objectContaining({ status: 'failed' }),
    }));
    expect(prismaMock.request.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );
  });

  describe('a cancel that lands while the search runs', () => {
    const indexerConfig = async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, categories: [3030] }]);
      }
      if (key === 'indexer_flag_config') return JSON.stringify([]);
      return null;
    };
    const run = async (id: string) => {
      const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
      return processSearchIndexers({
        requestId: id,
        audiobook: { id: `a-${id}`, title: 'Book', author: 'Author' },
        jobId: `job-${id}`,
      });
    };
    const expectNotRequeued = (id: string, result: unknown) => {
      // Main overwrote the cancel with a plain 'awaiting_search' write, so the
      // scheduled re-search jobs picked the request up again
      expect(prismaMock.request.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'awaiting_search' }) })
      );
      expect(prismaMock.request.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
        where: { id, deletedAt: null, status: { not: 'cancelled' } },
        data: expect.objectContaining({ status: 'awaiting_search' }),
      }));
      expect(result).toMatchObject({ success: true, requestId: id });
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    };

    beforeEach(() => {
      configMock.get.mockImplementation(indexerConfig);
      // The 'searching' claim matches; the 'awaiting_search' write matches nothing (cancelled meanwhile)
      prismaMock.request.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    });

    it('does not re-queue it when the search finds nothing', async () => {
      prowlarrMock.searchWithVariations.mockResolvedValue([]);

      expectNotRequeued('req-none', await run('req-none'));
    });

    it('does not re-queue it when nothing reaches the quality threshold', async () => {
      prowlarrMock.searchWithVariations.mockResolvedValue([
        {
          indexer: 'Indexer',
          indexerId: 1,
          title: 'Something Else Entirely - Another Writer',
          size: 50 * 1024 * 1024,
          seeders: 10,
          publishDate: new Date(),
          downloadUrl: 'magnet:?xt=urn:btih:low',
          guid: 'g-low',
          format: 'M4B',
        },
      ]);

      expectNotRequeued('req-low', await run('req-low'));
    });
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
      expect.objectContaining({ title: 'Good Release - Author' }),
      []
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
      expect.objectContaining({ title: 'Good Release - Author' }),
      []
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
    expect(prismaMock.request.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'req-exhausted', deletedAt: null, status: { not: 'cancelled' } },
        data: expect.objectContaining({
          status: 'awaiting_search',
          errorMessage: 'No usable releases — 2 candidates tried, all blocked',
        }),
      })
    );
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });
});


