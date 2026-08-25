/**
 * Component: Monitor RSS Feeds Processor Tests
 * Documentation: documentation/backend/services/scheduler.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));
const jobQueueMock = createJobQueueMock();
const prowlarrMock = vi.hoisted(() => ({ getAllRssFeeds: vi.fn() }));

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

function futureDate(days = 30): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

describe('processMonitorRssFeeds', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    // Default to empty blocklist so the filter is a no-op unless a test overrides.
    prismaMock.blockedRelease.findMany.mockResolvedValue([]);
  });

  it('matches RSS items and queues search jobs', async () => {
    // Indexer config + skip_unreleased setting both read via the same mock — return appropriate value per key.
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', rssEnabled: true }]);
      }
      if (key === 'indexer.skip_unreleased') {
        return null; // default ON
      }
      return null;
    });

    prowlarrMock.getAllRssFeeds.mockResolvedValue([
      { title: 'Great Book - Author Name' },
    ]);

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-1',
        type: 'audiobook',
        status: 'awaiting_search',
        releaseDate: null,
        audiobook: { id: 'a1', title: 'Great Book', author: 'Author Name', audibleAsin: 'ASIN1' },
      },
    ]);

    const { processMonitorRssFeeds } = await import('@/lib/processors/monitor-rss-feeds.processor');
    const result = await processMonitorRssFeeds({ jobId: 'job-1' });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith(
      'req-1',
      expect.objectContaining({ title: 'Great Book', author: 'Author Name' })
    );
    expect(prismaMock.request.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { id: 'asc' },
      take: 100,
    }));
  });

  it('pages beyond the first 100 awaiting requests', async () => {
    vi.useFakeTimers();
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', rssEnabled: true }]);
      }
      return null;
    });
    prowlarrMock.getAllRssFeeds.mockResolvedValue([
      { title: 'Target Story - Target Author' },
    ]);

    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `req-${String(index).padStart(3, '0')}`,
      type: 'audiobook',
      status: 'awaiting_search',
      releaseDate: null,
      audiobook: {
        id: `a-${index}`,
        title: `Unrelated Volume ${index}`,
        author: 'Someone Else',
        audibleAsin: `ASIN-${index}`,
      },
    }));
    const secondPage = [{
      id: 'req-target',
      type: 'audiobook',
      status: 'awaiting_search',
      releaseDate: null,
      audiobook: {
        id: 'a-target',
        title: 'Target Story',
        author: 'Target Author',
        audibleAsin: 'ASIN-TARGET',
      },
    }];
    prismaMock.request.findMany
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);

    const { processMonitorRssFeeds } = await import('@/lib/processors/monitor-rss-feeds.processor');
    const processing = processMonitorRssFeeds({ jobId: 'job-paged' });
    await vi.runAllTimersAsync();
    const result = await processing;

    expect(result.totalMissing).toBe(101);
    expect(result.matched).toBe(1);
    expect(prismaMock.request.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      orderBy: { id: 'asc' },
      cursor: { id: 'req-099' },
      skip: 1,
      take: 100,
    }));
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith(
      'req-target',
      expect.objectContaining({ title: 'Target Story', author: 'Target Author' })
    );
    vi.useRealTimers();
  });

  it('skips RSS auto-search when matched book is unreleased and setting ON', async () => {
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', rssEnabled: true }]);
      }
      if (key === 'indexer.skip_unreleased') {
        return 'true';
      }
      return null;
    });

    prowlarrMock.getAllRssFeeds.mockResolvedValue([
      { title: 'Future Book - Author Name' },
    ]);

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-future',
        type: 'audiobook',
        status: 'awaiting_search',
        releaseDate: futureDate(45),
        audiobook: { id: 'a-future', title: 'Future Book', author: 'Author Name', audibleAsin: 'ASIN-F' },
      },
    ]);

    const { processMonitorRssFeeds } = await import('@/lib/processors/monitor-rss-feeds.processor');
    const result = await processMonitorRssFeeds({ jobId: 'job-2' });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    // Request status must not be mutated by RSS processor.
    expect(prismaMock.request.update).not.toHaveBeenCalled();
  });

  it('does not queue a search when the matching RSS release is on the request blocklist', async () => {
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', rssEnabled: true }]);
      }
      if (key === 'indexer.skip_unreleased') return null;
      return null;
    });

    prowlarrMock.getAllRssFeeds.mockResolvedValue([
      { title: 'Great Book - Author Name' },
    ]);

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-blocked',
        type: 'audiobook',
        status: 'awaiting_search',
        releaseDate: null,
        audiobook: { id: 'a1', title: 'Great Book', author: 'Author Name', audibleAsin: 'ASIN1' },
      },
    ]);

    // The RSS torrent's normalized name is on the request's blocklist.
    prismaMock.blockedRelease.findMany.mockResolvedValue([
      { id: 'b1', releaseKey: 'great book - author name', releaseHash: null },
    ]);

    const { processMonitorRssFeeds } = await import('@/lib/processors/monitor-rss-feeds.processor');
    const result = await processMonitorRssFeeds({ jobId: 'job-rss-blocked' });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
  });

  it('runs RSS search when matched book is unreleased but setting is OFF', async () => {
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', rssEnabled: true }]);
      }
      if (key === 'indexer.skip_unreleased') {
        return 'false';
      }
      return null;
    });

    prowlarrMock.getAllRssFeeds.mockResolvedValue([
      { title: 'Future Book - Author Name' },
    ]);

    prismaMock.request.findMany.mockResolvedValue([
      {
        id: 'req-future-off',
        type: 'audiobook',
        status: 'awaiting_search',
        releaseDate: futureDate(45),
        audiobook: { id: 'a-future', title: 'Future Book', author: 'Author Name', audibleAsin: 'ASIN-F' },
      },
    ]);

    const { processMonitorRssFeeds } = await import('@/lib/processors/monitor-rss-feeds.processor');
    const result = await processMonitorRssFeeds({ jobId: 'job-3' });

    expect(result.success).toBe(true);
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith(
      'req-future-off',
      expect.objectContaining({ title: 'Future Book', author: 'Author Name' })
    );
    expect(prismaMock.request.update).not.toHaveBeenCalled();
  });
});
