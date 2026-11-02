/**
 * Component: Search Ebook Processor Indexer Query Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * The automatic ebook search must query indexers with title + author
 * (searchWithVariations), the same way audiobook search does.
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

describe('processSearchEbook indexer search query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configServiceMock.getAudibleRegion.mockResolvedValue('us');
    configServiceMock.get.mockImplementation(async (key: string) => {
      if (key === 'ebook_sidecar_preferred_format') return 'epub';
      if (key === 'ebook_annas_archive_enabled') return 'false';
      if (key === 'ebook_indexer_search_enabled') return 'true';
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, ebookCategories: [7020] }]);
      }
      if (key === 'indexer_flag_config') return JSON.stringify([]);
      return null;
    });
    prismaMock.blockedRelease.findMany.mockResolvedValue([]);
  });

  it('sends title + author through searchWithVariations and downloads the match', async () => {
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.request.findUnique.mockResolvedValue({ id: 'req-9', parentRequest: { id: 'parent-9' } });
    prowlarrMock.searchWithVariations.mockResolvedValue([
      {
        indexer: 'Indexer',
        indexerId: 1,
        title: 'Indexer Author - Indexer Book (epub)',
        size: 2 * 1024 * 1024,
        seeders: 5,
        publishDate: new Date(),
        downloadUrl: 'magnet:?xt=urn:btih:ebook',
        guid: 'guid-ebook',
        format: 'EPUB',
      },
    ]);

    const { processSearchEbook } = await import('@/lib/processors/search-ebook.processor');
    const result = await processSearchEbook({
      requestId: 'req-9',
      audiobook: { id: 'ab-9', title: 'Indexer Book', author: 'Indexer Author' },
      jobId: 'job-9',
    });

    // Query assertions first, so a title-only search fails here rather than on a swallowed error
    expect(prowlarrMock.search).not.toHaveBeenCalled();
    expect(prowlarrMock.searchWithVariations).toHaveBeenCalledTimes(1);
    expect(prowlarrMock.searchWithVariations).toHaveBeenCalledWith('Indexer Book', 'Indexer Author', {
      categories: [7020],
      indexerIds: [1],
      minSeeders: 0,
      maxResults: 100,
    });
    expect(result.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith(
      'req-9',
      { id: 'parent-9', title: 'Indexer Book', author: 'Indexer Author' },
      expect.objectContaining({ title: 'Indexer Author - Indexer Book (epub)' })
    );
  });

  it('uses custom search terms in place of the title and keeps the author', async () => {
    prismaMock.request.update.mockResolvedValue({ customSearchTerms: 'Custom Terms' });
    prowlarrMock.searchWithVariations.mockResolvedValue([]);

    const { processSearchEbook } = await import('@/lib/processors/search-ebook.processor');
    await processSearchEbook({
      requestId: 'req-10',
      audiobook: { id: 'ab-10', title: 'Original Title', author: 'Real Author' },
      jobId: 'job-10',
    });

    expect(prowlarrMock.search).not.toHaveBeenCalled();
    expect(prowlarrMock.searchWithVariations).toHaveBeenCalledWith(
      'Custom Terms',
      'Real Author',
      expect.objectContaining({ categories: [7020], indexerIds: [1] })
    );
  });
});
