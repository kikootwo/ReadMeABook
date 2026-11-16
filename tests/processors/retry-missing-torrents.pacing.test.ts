/**
 * Component: Retry Missing Torrents Processor Tests (search pacing, #601)
 * Documentation: documentation/backend/services/scheduler.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();
const configMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

const MINUTE = 60_000;

function request(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `req-${i}`,
    type: 'audiobook',
    status: 'awaiting_search',
    releaseDate: null,
    audiobook: { id: `ab-${i}`, title: `Book ${i}`, author: 'Author', audibleAsin: null },
    ...overrides,
  };
}

/** Run the sweep; the 100 ms gap between requests runs on fake timers */
async function runSweep() {
  const { processRetryMissingTorrents } = await import('@/lib/processors/retry-missing-torrents.processor');
  const pending = processRetryMissingTorrents({ jobId: 'job-1' });
  await vi.runAllTimersAsync();
  return pending;
}

/** Every queued search in queue order: [requestId, delay] */
type QueueCall = [string, unknown, ...Array<{ delay?: number } | undefined>];
function queuedSearches(): Array<[string, number | undefined]> {
  const audio = (jobQueueMock.addSearchJob.mock.calls as QueueCall[]).map(
    (call, n) => [call[0], call[2]?.delay, jobQueueMock.addSearchJob.mock.invocationCallOrder[n]] as const
  );
  const ebook = (jobQueueMock.addSearchEbookJob.mock.calls as QueueCall[]).map(
    (call, n) => [call[0], call[3]?.delay, jobQueueMock.addSearchEbookJob.mock.invocationCallOrder[n]] as const
  );
  return [...audio, ...ebook].sort((a, b) => a[2] - b[2]).map(([id, delay]) => [id, delay]);
}

function maxInAnyMinute(delays: number[]): number {
  return Math.max(...delays.map((start) => delays.filter((d) => d >= start && d < start + MINUTE).length));
}

describe('processRetryMissingTorrents search pacing (#601)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    configMock.get.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spreads 50 awaiting_search requests at most 2 per minute, in request order', async () => {
    prismaMock.request.findMany.mockResolvedValue(Array.from({ length: 50 }, (_, i) => request(i)));

    const result = await runSweep();

    expect(result.triggered).toBe(50);
    const searches = queuedSearches();
    expect(searches.map(([id]) => id)).toEqual(Array.from({ length: 50 }, (_, i) => `req-${i}`));
    const delays = searches.map(([, delay]) => delay ?? 0);
    expect(delays.slice(0, 5)).toEqual([0, 0, MINUTE, MINUTE, 2 * MINUTE]);
    expect(delays[49]).toBe(24 * MINUTE);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(maxInAnyMinute(delays)).toBe(2);
  });

  it('paces ebook searches the same way, sharing one schedule with audiobook searches', async () => {
    prismaMock.request.findMany.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => request(i, i % 2 ? { type: 'ebook' } : {}))
    );

    await runSweep();

    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledTimes(3);
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith(
      'req-1', expect.objectContaining({ id: 'ab-1' }), undefined, { delay: 0 }
    );
    expect(queuedSearches()).toEqual([
      ['req-0', 0], ['req-1', 0],
      ['req-2', MINUTE], ['req-3', MINUTE],
      ['req-4', 2 * MINUTE], ['req-5', 2 * MINUTE],
    ]);
  });

  it('paces released awaiting_release requests too, and skipped requests use no slot', async () => {
    const future = new Date(Date.now() + 30 * 24 * MINUTE * 60);
    prismaMock.request.findMany.mockResolvedValue([
      request(0, { status: 'awaiting_release', releaseDate: null }),
      request(1, { releaseDate: future }), // demoted to awaiting_release, no search
      request(2),
      request(3, { status: 'awaiting_release', releaseDate: null, type: 'ebook' }),
    ]);

    await runSweep();

    expect(queuedSearches()).toEqual([['req-0', 0], ['req-2', 0], ['req-3', MINUTE]]);
  });
});
