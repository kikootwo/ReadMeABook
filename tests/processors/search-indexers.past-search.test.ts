/**
 * Component: Search Indexers Processor Tests - requests past searching (#591)
 * Documentation: documentation/backend/services/jobs.md
 *
 * A search queued for a request (missing-torrents retry, RSS) can run after an Interactive
 * Search pick started its download. The fake request row below applies the stop guard's
 * real `where` (status not / notIn / in, deletedAt) so the conditional writes are exercised.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const configMock = vi.hoisted(() => ({ get: vi.fn(), getAudibleRegion: vi.fn() }));
const jobQueueMock = createJobQueueMock();
const prowlarrMock = vi.hoisted(() => ({ searchWithVariations: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ getProwlarrService: () => prowlarrMock }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getRuntime: vi.fn().mockResolvedValue(null) }),
}));

type StatusFilter = { not?: string; notIn?: string[]; in?: string[] };
const row: { id: string; status: string; deletedAt: Date | null } = { id: 'req-591', status: 'pending', deletedAt: null };
const writes: Record<string, unknown>[] = [];

const RESULTS = [
  { indexer: 'Indexer', indexerId: 1, title: 'Book - Author', size: 50 * 1024 * 1024, seeders: 10, publishDate: new Date(), downloadUrl: 'magnet:?xt=urn:btih:abc', guid: 'guid-1', format: 'M4B' },
];

const payload = { requestId: 'req-591', audiobook: { id: 'a1', title: 'Book', author: 'Author' }, jobId: 'job-591' };

async function runSearch() {
  const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');
  return processSearchIndexers(payload);
}

function expectNothingQueued() {
  expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  expect(prismaMock.blockedRelease.create).not.toHaveBeenCalled();
  expect(prismaMock.request.update).not.toHaveBeenCalled();
}

describe('processSearchIndexers on a request past searching (#591)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    row.status = 'pending';
    row.deletedAt = null;
    writes.length = 0;
    configMock.getAudibleRegion.mockResolvedValue('us');
    configMock.get.mockImplementation(async (key: string) => {
      if (key === 'prowlarr_indexers') {
        return JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, categories: [3030] }]);
      }
      if (key === 'indexer_flag_config') return JSON.stringify([]);
      return null;
    });
    prismaMock.blockedRelease.findMany.mockResolvedValue([]);
    prowlarrMock.searchWithVariations.mockResolvedValue(RESULTS);
    prismaMock.request.findUnique.mockImplementation(async () => ({
      status: row.status, deletedAt: row.deletedAt, customSearchTerms: null, audiobook: null,
    }));
    prismaMock.request.updateMany.mockImplementation(async ({ where, data }: { where: { id: string; deletedAt: null; status: StatusFilter }; data: Record<string, unknown> }) => {
      const s = where.status;
      const refused = where.id !== row.id
        || (where.deletedAt === null && row.deletedAt !== null)
        || (s.not !== undefined && row.status === s.not)
        || (s.notIn !== undefined && s.notIn.includes(row.status))
        || (s.in !== undefined && !s.in.includes(row.status));
      if (refused) return { count: 0 };
      if (typeof data.status === 'string') row.status = data.status;
      writes.push(data);
      return { count: 1 };
    });
  });

  it.each(['downloading', 'processing', 'downloaded', 'available'])(
    'skips a %s request: writes nothing, searches nothing, queues nothing',
    async (status) => {
      row.status = status;

      const result = await runSearch();

      expect(result).toEqual({ success: true, message: `Request is already ${status}, search skipped`, requestId: 'req-591' });
      expect(row.status).toBe(status);
      expect(writes).toEqual([]);
      expect(prowlarrMock.searchWithVariations).not.toHaveBeenCalled();
      expectNothingQueued();
    }
  );

  it.each(['downloading', 'awaiting_approval', 'cancelled'])(
    'queues no download when the request turns %s during the search',
    async (status) => {
      row.status = 'awaiting_search';
      prowlarrMock.searchWithVariations.mockImplementation(async () => {
        row.status = status; // an Interactive Search pick (or a cancel) lands while the indexers answer
        return RESULTS;
      });

      const result = await runSearch();

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/during the search, no download queued$/);
      expect(row.status).toBe(status);
      expect(writes).toHaveLength(1); // only the `searching` claim
      expectNothingQueued();
    }
  );

  it.each(['pending', 'awaiting_search', 'failed'])(
    'still queues the download when a route resets the request to %s after the claim (Manual Search, Retry)',
    async (status) => {
      row.status = 'failed';
      prowlarrMock.searchWithVariations.mockImplementation(async () => {
        row.status = status; // the route's own status write lands after the job's `searching` claim
        return RESULTS;
      });

      const result = await runSearch();

      expect(result.success).toBe(true);
      expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ['finds nothing', async () => []],
    ['has every indexer query fail', async () => { throw new Error('indexer down'); }],
  ])('keeps a pick made while the search %s: no awaiting_search write', async (_label, answer) => {
    row.status = 'awaiting_search';
    prowlarrMock.searchWithVariations.mockImplementation(async () => {
      row.status = 'downloading';
      return answer();
    });

    const result = await runSearch();

    expect(result).toEqual(expect.objectContaining({ success: true, message: 'Request moved to downloading during the search, not re-queued' }));
    expect(row.status).toBe('downloading');
    expect(writes).toHaveLength(1); // only the `searching` claim
    expectNothingQueued();
  });

  it('keeps a pick made while a next-release search finds nothing: no failed write, no notification', async () => {
    row.status = 'searching';
    prowlarrMock.searchWithVariations.mockImplementation(async () => {
      row.status = 'awaiting_approval';
      return [];
    });
    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');

    const result = await processSearchIndexers({ ...payload, clientFailures: 1 });

    expect(result.success).toBe(true);
    expect(row.status).toBe('awaiting_approval');
    expect(writes).toHaveLength(1);
    expectNothingQueued();
  });

  it('keeps a pick made during a search that then errors on its last attempt: no failed write, no notification', async () => {
    row.status = 'searching';
    prowlarrMock.searchWithVariations.mockImplementation(async () => {
      row.status = 'downloading';
      return RESULTS;
    });
    configMock.getAudibleRegion.mockRejectedValue(new Error('config read failed'));
    const { processSearchIndexers } = await import('@/lib/processors/search-indexers.processor');

    await expect(processSearchIndexers({ ...payload, clientFailures: 1 }, { attemptsMade: 2, attempts: 3 })).rejects.toThrow('config read failed');

    expect(row.status).toBe('downloading');
    expect(writes).toHaveLength(1);
    expectNothingQueued();
  });

  it.each(['pending', 'awaiting_search', 'searching', 'failed', 'warn'])(
    'searches a %s request and queues its download as before',
    async (status) => {
      row.status = status;

      const result = await runSearch();

      expect(result.success).toBe(true);
      expect(row.status).toBe('searching');
      expect(writes[0]).toEqual(expect.objectContaining({ status: 'searching', searchAttempts: { increment: 1 } }));
      expect(prowlarrMock.searchWithVariations).toHaveBeenCalledTimes(1);
      expect(jobQueueMock.addDownloadJob).toHaveBeenCalledTimes(1);
      expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith(
        'req-591', payload.audiobook, expect.objectContaining({ guid: 'guid-1' }), [], { clientFailures: 0 }
      );
    }
  );

  it.each([
    ['cancelled', null],
    ['downloading', new Date()],
  ])('still skips a %s request (deletedAt %s) as cancelled or deleted', async (status, deletedAt) => {
    row.status = status;
    row.deletedAt = deletedAt;

    const result = await runSearch();

    expect(result).toEqual({ success: true, message: 'Request cancelled or deleted, search skipped', requestId: 'req-591' });
    expect(writes).toEqual([]);
    expect(prowlarrMock.searchWithVariations).not.toHaveBeenCalled();
    expectNothingQueued();
  });
});
