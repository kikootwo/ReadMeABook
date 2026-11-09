/**
 * Component: Search Indexers Processor Audible DRM Tests (#518)
 * Documentation: documentation/phase3/ranking-algorithm.md
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
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getRuntime: async () => 1300 }),
}));

const release = (guid: string, title: string, sizeMB: number, seeders = 20) => ({
  indexer: 'Tracker',
  indexerId: 1,
  title,
  size: sizeMB * MB,
  seeders,
  publishDate: new Date('2024-01-01T00:00:00Z'),
  downloadUrl: `https://indexer/${guid}`,
  guid,
  protocol: 'torrent',
});

// The DRM releases have more seeders, so on main they rank first and are grabbed
const aax = release('aax', 'Frank Herbert - Dune [AAX]', 900, 500);
const aaxc = release('aaxc', 'Frank Herbert - Dune.aaxc', 900, 400);
const m4b = release('m4b', 'Frank Herbert - Dune [M4B]', 900, 5);
const sample = release('sample', 'Frank Herbert - Dune sample [M4B]', 10, 5);

const audiobook = { id: 'ab-1', title: 'Dune', author: 'Frank Herbert', asin: 'B0DUNE0001' };

async function runSearch() {
  const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
  return processSearchIndexers({ requestId: 'req-1', audiobook, jobId: 'job-1' });
}

async function runLogged() {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const result = await runSearch();
    return { result, lines: log.mock.calls.map((c) => String(c[0])) };
  } finally {
    log.mockRestore();
  }
}

describe('processSearchIndexers Audible DRM releases', () => {
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

  it('grabs the playable release, never a DRM one, and logs each DRM release once', async () => {
    prowlarrMock.searchWithVariations.mockResolvedValue([aax, aaxc, m4b, sample]);

    const { lines } = await runLogged();

    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    const [, , best, alternatives] = jobQueueMock.addDownloadJob.mock.calls[0];
    expect(best.guid).toBe('m4b');
    const fallbacks = alternatives.map((r: { guid: string }) => r.guid);
    expect(fallbacks).not.toContain('aax');
    expect(fallbacks).not.toContain('aaxc');

    const drmLines = lines.filter((line) => line.includes('Audible DRM release'));
    expect(drmLines).toEqual([
      expect.stringContaining('Skipping "Frank Herbert - Dune [AAX]" (Tracker): Audible DRM release ([AAX])'),
      expect.stringContaining('Skipping "Frank Herbert - Dune.aaxc" (Tracker): Audible DRM release (.aaxc)'),
    ]);
    // The size line counts only the sample, not the DRM releases
    expect(lines.filter((line) => line.includes('Filtered out'))).toEqual([
      expect.stringContaining('Filtered out 1 results < 20 MB or < 0.15 MB/min'),
    ]);
  });

  it('re-queues the request when every result is a DRM release', async () => {
    prowlarrMock.searchWithVariations.mockResolvedValue([aax, aaxc]);

    const { result, lines } = await runLogged();

    expect(result.success).toBe(false);
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(prismaMock.request.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'awaiting_search' }) })
    );
    expect(lines.filter((line) => line.includes('Filtered out'))).toEqual([]);
  });

  it('grabs a release converted from AAX', async () => {
    const converted = release('converted', 'Frank Herbert - Dune [M4B] (from AAX)', 900, 500);
    prowlarrMock.searchWithVariations.mockResolvedValue([converted, m4b]);

    await runSearch();

    expect(jobQueueMock.addDownloadJob.mock.calls[0][2].guid).toBe('converted');
  });
});
