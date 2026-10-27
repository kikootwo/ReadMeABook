/**
 * Component: Search Indexers Processor Series Position Tests (#330)
 * Documentation: documentation/phase3/match-gates.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const MB = 1024 * 1024;

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn(), getAudibleRegion: vi.fn() }));
const jobQueueMock = createJobQueueMock();
const prowlarrMock = vi.hoisted(() => ({ search: vi.fn(), searchWithVariations: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ getProwlarrService: () => prowlarrMock }));

const release = (guid: string, title: string) => ({
  indexer: 'Tracker',
  indexerId: 1,
  title,
  size: 600 * MB,
  seeders: 20,
  publishDate: new Date('2024-01-01T00:00:00Z'),
  downloadUrl: `https://indexer/${guid}`,
  guid,
  protocol: 'torrent',
});

const book2 = release('book-2', 'Rhaegar - Azarinth Healer 02 [M4B]');
const book3 = release('book-3', 'Rhaegar - Azarinth Healer 03 [M4B]');

// No ASIN: no runtime lookup, so the size floor stays out of these cases
const audiobook = { id: 'ab-1', title: 'Azarinth Healer: Book Three', author: 'Rhaegar' };

async function runSearch() {
  const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
  return processSearchIndexers({ requestId: 'req-1', audiobook, jobId: 'job-1' });
}

const catalog = (seriesPart: string | null) => ({
  customSearchTerms: null,
  audiobook: { series: 'Azarinth Healer', seriesPart },
});

describe('processSearchIndexers series position', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.blockedRelease.findMany.mockResolvedValue([]);
    configMock.getAudibleRegion.mockResolvedValue('us');
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Tracker', protocol: 'torrent', priority: 10, categories: [3030] }]);
      }
      return null;
    });
  });

  it('does not grab another book of the series when the catalog part is known', async () => {
    prismaMock.request.findUnique.mockResolvedValue(catalog('3'));
    prowlarrMock.searchWithVariations.mockResolvedValue([book2]);

    const result = await runSearch();

    expect(result.success).toBe(false);
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(prismaMock.request.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'awaiting_search' }) })
    );
  });

  it('grabs the right book and leaves the other out of the fallbacks', async () => {
    prismaMock.request.findUnique.mockResolvedValue(catalog('3'));
    prowlarrMock.searchWithVariations.mockResolvedValue([book2, book3]);

    await runSearch();

    expect(prismaMock.request.findUnique).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    const [, , best, alternatives] = jobQueueMock.addDownloadJob.mock.calls[0];
    expect(best.guid).toBe('book-3');
    expect(alternatives.map((r: { guid: string }) => r.guid)).not.toContain('book-2');
  });

  it('ranks as before when the catalog has no part', async () => {
    prismaMock.request.findUnique.mockResolvedValue(catalog(null));
    prowlarrMock.searchWithVariations.mockResolvedValue([book2]);

    await runSearch();

    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addDownloadJob.mock.calls[0][2].guid).toBe('book-2');
  });
});
