/**
 * Component: Search Indexers Processor Size Floor Tests
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
// Plain holder, not a factory mockImplementation, so clearAllMocks cannot wipe it
const runtime = vi.hoisted(() => ({ minutes: null as number | null }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ getProwlarrService: () => prowlarrMock }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getRuntime: async () => runtime.minutes }),
}));

const release = (guid: string, title: string, sizeMB: number) => ({
  indexer: 'Usenet',
  indexerId: 1,
  title,
  size: sizeMB * MB,
  seeders: undefined,
  publishDate: new Date('2024-01-01T00:00:00Z'),
  downloadUrl: `https://indexer/${guid}`,
  guid,
  protocol: 'usenet',
});

// One chapter file of a multi-file Usenet post: 57 MB for a 1182-minute book
const singleFile = release('part-44', 'Alastair Reynolds - The Prefect - 44 of 97.mp3', 57);
const fullRelease = release('full', 'Alastair Reynolds - The Prefect (Unabridged) MP3', 1100);

const audiobook = { id: 'ab-1', title: 'The Prefect', author: 'Alastair Reynolds', asin: 'B0PREFECT1' };

const filterLogLines = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => String(c[0])).filter((line) => line.includes('Filtered out'));

async function runSearch() {
  const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
  return processSearchIndexers({ requestId: 'req-1', audiobook, jobId: 'job-1' });
}

describe('processSearchIndexers size floor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.minutes = 1182;
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.blockedRelease.findMany.mockResolvedValue([]);
    configMock.getAudibleRegion.mockResolvedValue('us');
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Usenet', protocol: 'usenet', priority: 10, categories: [3030] }]);
      }
      return null;
    });
  });

  it('does not grab a single file of a multi-file post when the runtime is known', async () => {
    prowlarrMock.searchWithVariations.mockResolvedValue([singleFile]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runSearch();
    const lines = filterLogLines(log);
    log.mockRestore();

    expect(result.success).toBe(false);
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(prismaMock.request.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'awaiting_search' }) })
    );
    expect(lines).toEqual([expect.stringContaining('Filtered out 1 results < 20 MB or < 0.15 MB/min')]);
  });

  it('grabs the full release and leaves the single file out of the fallbacks', async () => {
    prowlarrMock.searchWithVariations.mockResolvedValue([singleFile, fullRelease]);

    await runSearch();

    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    const [, , best, alternatives] = jobQueueMock.addDownloadJob.mock.calls[0];
    expect(best.guid).toBe('full');
    expect(alternatives.map((r: { guid: string }) => r.guid)).not.toContain('part-44');
  });

  it('leaves results alone when no runtime is known', async () => {
    runtime.minutes = null;
    const tiny = release('tiny', 'Alastair Reynolds - The Prefect sample.mp3', 10);
    prowlarrMock.searchWithVariations.mockResolvedValue([singleFile, tiny]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runSearch();
    const lines = filterLogLines(log);
    log.mockRestore();

    // The log names the floor only when a runtime is known
    expect(lines).toEqual([expect.stringContaining('Filtered out 1 results < 20 MB')]);
    expect(lines[0]).not.toContain('MB/min');
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addDownloadJob.mock.calls[0][2].guid).toBe('part-44');
  });
});
