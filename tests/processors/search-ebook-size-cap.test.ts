/**
 * Component: Search Ebook Processor Size Cap Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Automatic ebook search keeps the EBOOK_MAX_SIZE_MB cap: an indexer result
 * over it is skipped, one at or under it is downloaded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
  getAudibleRegion: vi.fn().mockResolvedValue('us'),
}));

const jobQueueMock = vi.hoisted(() => ({
  addStartDirectDownloadJob: vi.fn(() => Promise.resolve()),
  addDownloadJob: vi.fn(() => Promise.resolve()),
}));

const prowlarrMock = vi.hoisted(() => ({
  search: vi.fn(),
  searchWithVariations: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/ebook-scraper', () => ({
  searchByAsin: vi.fn(),
  searchByTitle: vi.fn(),
  getSlowDownloadLinks: vi.fn(),
}));
vi.mock('@/lib/integrations/prowlarr.service', () => ({
  getProwlarrService: async () => prowlarrMock,
}));

const MB = 1024 * 1024;

function indexerResult(guid: string, size: number) {
  return {
    indexer: 'Indexer',
    indexerId: 1,
    title: `Jane Writer - Big Picture Book (pdf) ${guid}`,
    size,
    seeders: 10,
    publishDate: new Date('2024-01-01T00:00:00Z'),
    downloadUrl: `magnet:?xt=urn:btih:${guid}`,
    guid,
  };
}

async function runSearch() {
  const { processSearchEbook } = await import('@/lib/processors/search-ebook.processor');
  return processSearchEbook({
    requestId: 'req-1',
    audiobook: { id: 'ab-1', title: 'Big Picture Book', author: 'Jane Writer' },
    jobId: 'job-1',
  });
}

function downloadedGuid(): string | undefined {
  const call = jobQueueMock.addDownloadJob.mock.calls[0] as unknown[] | undefined;
  return (call?.[2] as { guid?: string } | undefined)?.guid;
}

describe('processSearchEbook size cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'ebook_sidecar_preferred_format') return 'pdf';
      if (key === 'ebook_annas_archive_enabled') return 'false';
      if (key === 'ebook_indexer_search_enabled') return 'true';
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, ebookCategories: [7020] }]);
      }
      if (key === 'indexer_flag_config') return JSON.stringify([]);
      return null;
    });
    prismaMock.blockedRelease.findMany.mockResolvedValue([]);
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.request.findUnique.mockResolvedValue({ id: 'req-1', parentRequest: { id: 'parent-1' } });
  });

  it('skips a 35 MB result', async () => {
    prowlarrMock.searchWithVariations.mockResolvedValue([indexerResult('big', 35 * MB)]);

    const result = await runSearch();

    expect(prowlarrMock.searchWithVariations).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('downloads a 5 MB result over a 35 MB one', async () => {
    prowlarrMock.searchWithVariations.mockResolvedValue([indexerResult('big', 35 * MB), indexerResult('small', 5 * MB)]);

    const result = await runSearch();

    expect(result.success).toBe(true);
    expect(downloadedGuid()).toBe('small');
  });

  it('downloads a result exactly at the cap', async () => {
    prowlarrMock.searchWithVariations.mockResolvedValue([indexerResult('at-cap', 20 * MB)]);

    const result = await runSearch();

    expect(result.success).toBe(true);
    expect(downloadedGuid()).toBe('at-cap');
  });

  it('skips a result one byte over the cap', async () => {
    prowlarrMock.searchWithVariations.mockResolvedValue([indexerResult('over-cap', 20 * MB + 1)]);

    const result = await runSearch();

    expect(result.success).toBe(false);
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });
});
