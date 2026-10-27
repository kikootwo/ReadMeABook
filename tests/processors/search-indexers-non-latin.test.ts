/**
 * Component: Search Indexers Processor Tests (non-Latin requests, one-word titles)
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn(), getAudibleRegion: vi.fn().mockResolvedValue('us') }));
const jobQueueMock = createJobQueueMock();
const prowlarrMock = vi.hoisted(() => ({ search: vi.fn(), searchWithVariations: vi.fn() }));
const audibleMock = vi.hoisted(() => ({ getRuntime: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ getProwlarrService: () => prowlarrMock }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleMock,
}));

const release = (guid: string, title: string, seeders: number) => ({
  indexer: 'Indexer',
  indexerId: 1,
  title,
  size: 300 * 1024 * 1024,
  seeders,
  publishDate: new Date('2025-01-01T00:00:00Z'),
  downloadUrl: `magnet:?xt=urn:btih:${guid}`,
  guid,
  format: 'M4B' as const,
});

// 300 MB over a 300-minute runtime earns full size points, so a full title/author match is what decides the threshold
const audiobook = { id: 'a1', title: 'Мастер и Маргарита', author: 'Михаил Булгаков', asin: 'B000000001' };

describe('processSearchIndexers with a Cyrillic request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.blockedRelease.findMany.mockResolvedValue([]);
    configMock.getAudibleRegion.mockResolvedValue('us');
    audibleMock.getRuntime.mockResolvedValue(300);
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, categories: [3030] }]);
      }
      if (key === 'indexer_flag_config') return JSON.stringify([]);
      return null;
    });
  });

  it('queues no download when every result is a different book', async () => {
    prowlarrMock.searchWithVariations.mockResolvedValue([
      release('war', 'Лев Толстой - Война и мир [M4B]', 500),
      release('heart', 'Михаил Булгаков - Собачье сердце [M4B]', 300),
      release('master', 'Лев Толстой - Мастер и Маргарита [M4B]', 200),
    ]);

    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
    const result = await processSearchIndexers({ requestId: 'req-ru', audiobook, jobId: 'job-ru' });

    expect(result.success).toBe(false);
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(prismaMock.request.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'awaiting_search', errorMessage: 'No quality matches found. Will retry automatically.' }),
      })
    );
  });

  it('downloads the matching release, not a better-seeded different book', async () => {
    prowlarrMock.searchWithVariations.mockResolvedValue([
      release('war', 'Лев Толстой - Война и мир [M4B]', 500),
      release('right', 'Михаил Булгаков - Мастер и Маргарита [M4B]', 20),
    ]);

    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
    const result = await processSearchIndexers({ requestId: 'req-ru', audiobook, jobId: 'job-ru' });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith(
      'req-ru',
      expect.objectContaining({ id: 'a1', title: audiobook.title }),
      expect.objectContaining({ guid: 'right' }),
      [],
    );
  });
});

describe('processSearchIndexers with a one-word title', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.update.mockResolvedValue({});
    prismaMock.blockedRelease.findMany.mockResolvedValue([]);
    configMock.getAudibleRegion.mockResolvedValue('us');
    audibleMock.getRuntime.mockResolvedValue(300);
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'usenet', priority: 10, categories: [3030] }]);
      }
      if (key === 'indexer_flag_config') return JSON.stringify([]);
      return null;
    });
  });

  it('waits for a later search instead of grabbing a book that only contains the title word', async () => {
    // An NZB result has no seeders field and gets full seeder points: on main this scored 56.6 and was grabbed
    const nzb = { ...release('darker', 'You Like It Darker by Stephen King [ENG / M4B]', 0), seeders: undefined };
    prowlarrMock.searchWithVariations.mockResolvedValue([nzb]);

    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
    const result = await processSearchIndexers({
      requestId: 'req-it', audiobook: { id: 'a2', title: 'It', author: 'Stephen King', asin: 'B000000002' }, jobId: 'job-it',
    });

    expect(result.success).toBe(false);
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(prismaMock.request.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'awaiting_search' }) })
    );
  });
});
