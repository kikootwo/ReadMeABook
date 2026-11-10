/**
 * Component: Search Indexers Processor Tests (search for the next release, #332)
 * Documentation: documentation/admin-features/release-blocklist.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn(), getAudibleRegion: vi.fn().mockResolvedValue('us') }));
const jobQueueMock = createJobQueueMock();
const prowlarrMock = vi.hoisted(() => ({ search: vi.fn(), searchWithVariations: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ getProwlarrService: () => prowlarrMock }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getRuntime: vi.fn().mockResolvedValue(null) }),
}));

const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');

const release = (title: string, extra: Record<string, unknown> = {}) => ({
  indexer: 'Indexer', indexerId: 1, title, size: 300 * 1024 * 1024, seeders: 10, publishDate: new Date(),
  downloadUrl: `https://prowlarr/1/download/${encodeURIComponent(title)}`, guid: `guid-${title}`, format: 'M4B', ...extra,
});
const GOOD = release('Author - Book [M4B]');
const BLOCKED = release('Author - Book (Unabridged) [MP3]');
const WRONG_BOOK = release('Someone Else - Another Thing [M4B]');

/** Answer every indexer search with `results`; `failedQueries` of them count as failed (#522 stats) */
const searchAnswers = (results: unknown[], failedQueries = 0) => {
  prowlarrMock.searchWithVariations.mockImplementation(async (_t: string, _a: string, _o: unknown, _x: unknown, stats: any) => {
    stats.queriesSent += 1 + failedQueries;
    stats.queriesFailed += failedQueries;
    for (let i = 0; i < failedQueries; i++) stats.failures.push({ query: 'Book Author', message: 'HTTP 500' });
    return results;
  });
};

const run = (clientFailures?: number) => processSearchIndexers({
  requestId: 'req-1',
  audiobook: { id: 'book-1', title: 'Book', author: 'Author' },
  jobId: 'job-1',
  ...(clientFailures !== undefined && { clientFailures }),
});

const lastWrite = () => prismaMock.request.updateMany.mock.calls.at(-1)?.[0].data;

describe('processSearchIndexers and the next release after a client failure (#332)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.request.findUnique.mockResolvedValue({
      id: 'req-1', customSearchTerms: null, audiobook: { title: 'Book', author: 'Author', series: null, seriesPart: null },
      user: { plexUsername: 'user' },
    });
    prismaMock.blockedRelease.findMany.mockResolvedValue([]);
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    configMock.getAudibleRegion.mockResolvedValue('us');
    configMock.get.mockImplementation(async (key: string) => (key === 'prowlarr_indexers'
      ? JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, categories: [3030] }])
      : null));
  });

  it('a new search starts the automatic chain at 0', async () => {
    searchAnswers([GOOD]);
    await run();
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith('req-1', expect.anything(), expect.objectContaining({ title: GOOD.title }), [], { clientFailures: 0 });
  });

  it('the search for the next release carries its count to the grab', async () => {
    searchAnswers([GOOD]);
    await run(2);
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith('req-1', expect.anything(), expect.anything(), [], { clientFailures: 2 });
  });

  it('every candidate blocked: the request fails with one notification', async () => {
    searchAnswers([BLOCKED]);
    prismaMock.blockedRelease.findMany.mockResolvedValue([{ releaseKey: BLOCKED.title.toLowerCase(), releaseHash: null }]);

    const result = await run(1);

    const message = 'Download failed; no other release found: No usable releases — 1 candidates tried, all blocked';
    expect(result).toMatchObject({ success: false, message });
    expect(lastWrite()).toEqual(expect.objectContaining({ status: 'failed', errorMessage: message }));
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith('request_error', 'req-1', 'Book', 'Author', 'user', message);
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  });

  it('nothing above the quality threshold: the request fails with one notification', async () => {
    searchAnswers([WRONG_BOOK]);

    await run(1);

    expect(lastWrite()).toEqual(expect.objectContaining({
      status: 'failed', errorMessage: 'Download failed; no other release found: No quality matches found',
    }));
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledTimes(1);
  });

  it('nothing found at all, every indexer search answered: the request fails (no "will retry")', async () => {
    searchAnswers([]);

    await run(2);

    expect(lastWrite()).toEqual(expect.objectContaining({
      status: 'failed', errorMessage: 'Download failed; no other release found: No torrents/nzbs found',
    }));
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledTimes(1);
  });

  it('nothing found and an indexer search failed: awaiting_search as usual (#522), no notification', async () => {
    searchAnswers([], 1);

    await run(1);

    expect(lastWrite()).toEqual(expect.objectContaining({ status: 'awaiting_search' }));
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  });

  it.each([undefined, 0])('nothing found outside a chain (count %s): awaiting_search as before', async (count) => {
    searchAnswers([]);

    await run(count);

    expect(lastWrite()).toEqual(expect.objectContaining({ status: 'awaiting_search' }));
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  });

  it('a cancel that lands during the search: nothing written over it, no notification', async () => {
    searchAnswers([BLOCKED]);
    prismaMock.blockedRelease.findMany.mockResolvedValue([{ releaseKey: BLOCKED.title.toLowerCase(), releaseHash: null }]);
    prismaMock.request.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });

    const result = await run(1);

    expect(result.success).toBe(true);
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  });
});
