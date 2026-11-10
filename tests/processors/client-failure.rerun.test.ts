/**
 * Component: Client-Reported Download Failure Tests, second runs and chain notifications (#332)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * A second run of the failure handler (a Bull rerun after a kill or restart, a stalled lock, a
 * second monitor chain) must never leave the request in `searching`, never queue a second search
 * and never send a second notification. Uses a small stateful fake of the rows the handler reads.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createJobQueueMock } from '../helpers/job-queue';

const prismaMock = createPrismaMock();
const jobQueueMock = createJobQueueMock();

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));

import type { ClientFailureInput } from '@/lib/processors/client-failure';

const { MAX_CLIENT_FAILURES, handleClientReportedFailure, nextReleaseSearchJobId } = await import('@/lib/processors/client-failure');

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ClientFailureInput['logger'];

/** The rows the handler reads and writes */
interface State {
  requestStatus: string;
  newestSelected: string;
  history: Record<string, string | null>;
  /** Bull job ids that have a `jobs` row with that id */
  jobRows: Set<string>;
  /** Bull job ids Bull itself keeps (any state) */
  bullJobs: Set<string>;
  /** Run before the guarded request write reads the status (a search ending at that moment) */
  beforeRequestWrite?: () => void;
}
let state: State;

const input = (overrides: Partial<ClientFailureInput> = {}): ClientFailureInput => ({
  requestId: 'req-1',
  downloadHistoryId: 'dh-1',
  clientType: 'sabnzbd',
  clientError: 'Out of retention',
  clientFailures: 0,
  logger,
  ...overrides,
});

const notifications = () => jobQueueMock.addNotificationJob.mock.calls.map((call) => call[5] as string);
const statusWrites = () => prismaMock.request.updateMany.mock.calls.map(([arg]) => arg.data.status);

/** The state the first run leaves when it completes and its search then ends with `status` */
const firstRunCompletedThenSearchEnded = (status: string) => {
  state.requestStatus = status;
  state.jobRows.add(nextReleaseSearchJobId('dh-1'));
  state.bullJobs.add(nextReleaseSearchJobId('dh-1'));
};

describe('handleClientReportedFailure, second runs and notifications per chain (#332)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The monitor marks the download row `failed` before it calls the handler
    state = { requestStatus: 'downloading', newestSelected: 'dh-1', history: { 'dh-1': 'failed' }, jobRows: new Set(), bullJobs: new Set() };

    prismaMock.request.findUnique.mockImplementation(async () => ({
      id: 'req-1',
      status: state.requestStatus,
      deletedAt: null,
      audiobook: { id: 'book-1', title: 'Book', author: 'Author', audibleAsin: null },
      user: { plexUsername: 'user' },
    }));
    prismaMock.request.updateMany.mockImplementation(async ({ where, data }: {
      where: { status?: { in?: string[]; not?: string } };
      data: { status: string };
    }) => {
      state.beforeRequestWrite?.();
      state.beforeRequestWrite = undefined;
      const allowed: string[] | undefined = where.status?.in;
      const matches = allowed ? allowed.includes(state.requestStatus) : state.requestStatus !== where.status?.not;
      if (!matches) return { count: 0 };
      state.requestStatus = data.status;
      return { count: 1 };
    });
    prismaMock.downloadHistory.findFirst.mockImplementation(async () => ({ id: state.newestSelected }));
    prismaMock.downloadHistory.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id, downloadStatus: state.history[where.id] ?? null,
      torrentName: `Release ${where.id}`, torrentHash: null, nzbId: `nzb-${where.id}`, indexerName: 'Indexer', indexerId: 1,
    }));
    prismaMock.downloadHistory.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: { downloadStatus: string } }) => {
      state.history[where.id] = data.downloadStatus;
      return {};
    });
    prismaMock.job.findFirst.mockImplementation(async ({ where }: { where: { bullJobId: string } }) =>
      (state.jobRows.has(where.bullJobId) ? { id: 'job-row' } : null));
    prismaMock.blockedRelease.upsert.mockResolvedValue({ id: 'block-1', createdAt: new Date() });
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    jobQueueMock.addSearchJob.mockImplementation(async (_r: string, _b: unknown, chain: { jobId: string }) => {
      state.jobRows.add(chain.jobId);
      state.bullJobs.add(chain.jobId);
      return 'job-search';
    });
    jobQueueMock.hasBullJob.mockImplementation(async (bullJobId: string) => state.bullJobs.has(bullJobId));
  });

  it.each(['failed', 'awaiting_search'])('a rerun after the next search ended %s writes nothing, queues nothing, notifies nothing', async (ended) => {
    firstRunCompletedThenSearchEnded(ended);

    await expect(handleClientReportedFailure(input())).resolves.toBe('already_handled');

    expect(state.requestStatus).toBe(ended);
    expect(statusWrites()).toEqual([]);
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(notifications()).toEqual([]);
  });

  it('a rerun while the next search waits or runs (its jobs row exists) writes nothing and sends no second notification', async () => {
    firstRunCompletedThenSearchEnded('searching');

    await expect(handleClientReportedFailure(input())).resolves.toBe('already_handled');

    expect(statusWrites()).toEqual([]);
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(notifications()).toEqual([]);
  });

  it('a rerun after the next search grabbed another release leaves the request to that download', async () => {
    firstRunCompletedThenSearchEnded('downloading');
    state.newestSelected = 'dh-2';

    await expect(handleClientReportedFailure(input())).resolves.toBe('stale');

    expect(state.requestStatus).toBe('downloading');
    expect(statusWrites()).toEqual([]);
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(notifications()).toEqual([]);
  });

  it('the search ended failed but its jobs row never got its Bull id (cut after queue.add): the rerun still writes nothing', async () => {
    state.requestStatus = 'failed';

    await expect(handleClientReportedFailure(input())).resolves.toBe('already_handled');

    expect(state.requestStatus).toBe('failed');
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(notifications()).toEqual([]);
  });

  it.each([
    ['still waits or runs', 'searching'],
    ['grabbed and is adding the next release', 'downloading'],
  ])('cut after queue.add, the next search %s: Bull keeps the job, so the rerun writes nothing and sends no second notification', async (_when, status) => {
    state.requestStatus = status;
    state.bullJobs.add(nextReleaseSearchJobId('dh-1')); // the jobs row never got this Bull id

    await expect(handleClientReportedFailure(input())).resolves.toBe('already_handled');

    expect(state.requestStatus).toBe(status);
    expect(statusWrites()).toEqual([]);
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(notifications()).toEqual([]);
  });

  it('the queue lookup throws: the rerun falls back to the request status and still queues a cut run\'s search', async () => {
    state.requestStatus = 'searching';
    jobQueueMock.hasBullJob.mockRejectedValue(new Error('Redis down'));

    await expect(handleClientReportedFailure(input())).resolves.toBe('next_release');

    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
  });

  it('the request status alone decides a hand-picked rerun: request already failed, download row not failed, nothing written or sent', async () => {
    state.requestStatus = 'failed';
    state.history['dh-1'] = 'removed'; // a row the monitor's status write skips

    await expect(handleClientReportedFailure(input({ clientFailures: undefined }))).resolves.toBe('already_handled');

    expect(statusWrites()).toEqual([]);
    expect(notifications()).toEqual([]);
  });

  it('a hard kill between the request write and the queue call: the rerun queues the search, once, with one notification', async () => {
    state.requestStatus = 'searching';

    await expect(handleClientReportedFailure(input())).resolves.toBe('next_release');

    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-1', expect.anything(), { clientFailures: 1, jobId: 'next-release-dh-1' });
    expect(state.requestStatus).toBe('searching');
    expect(notifications()).toEqual(['Download failed in SABnzbd. Trying another release (attempt 2 of 3).']);
  });

  it('two runs back to back: one search, one notification', async () => {
    await expect(handleClientReportedFailure(input())).resolves.toBe('next_release');
    await expect(handleClientReportedFailure(input())).resolves.toBe('already_handled');

    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
    expect(notifications()).toHaveLength(1);
  });

  it('the next search ends failed between the check and the request write: the write matches nothing and the request stays failed', async () => {
    state.beforeRequestWrite = () => { state.requestStatus = 'failed'; };

    await expect(handleClientReportedFailure(input())).resolves.toBe('already_handled');

    expect(state.requestStatus).toBe('failed');
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(notifications()).toEqual([]);
  });

  it('a rerun of a failure that ended the request sends no second closing notification', async () => {
    await expect(handleClientReportedFailure(input({ clientFailures: undefined }))).resolves.toBe('failed');
    await expect(handleClientReportedFailure(input({ clientFailures: undefined }))).resolves.toBe('already_handled');

    expect(state.requestStatus).toBe('failed');
    expect(notifications()).toEqual(['Download failed in SABnzbd']);
  });

  it(`a chain that fails ${MAX_CLIENT_FAILURES} releases in a row sends ${MAX_CLIENT_FAILURES} notifications, the last one closing`, async () => {
    for (let failures = 0; failures < MAX_CLIENT_FAILURES; failures++) {
      const historyId = `dh-${failures + 1}`;
      state.newestSelected = historyId;
      state.history[historyId] = 'downloading';
      state.requestStatus = 'downloading';
      await handleClientReportedFailure(input({ downloadHistoryId: historyId, clientFailures: failures }));
    }

    expect(notifications()).toEqual([
      'Download failed in SABnzbd. Trying another release (attempt 2 of 3).',
      'Download failed in SABnzbd. Trying another release (attempt 3 of 3).',
      '3 releases in a row failed in the download client; last: Download failed in SABnzbd',
    ]);
    expect(state.requestStatus).toBe('failed');
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(MAX_CLIENT_FAILURES - 1);
  });

  it('a hand-picked run whose download left a next search behind (jobs row and Bull job exist) ends a downloading request failed, with one notification', async () => {
    firstRunCompletedThenSearchEnded('downloading');

    await expect(handleClientReportedFailure(input({ clientFailures: undefined }))).resolves.toBe('failed');

    expect(state.requestStatus).toBe('failed');
    expect(notifications()).toEqual(['Download failed in SABnzbd']);
  });

  it('chain failure, the next search ends failed, Retry download resumes the same download, it fails again: the request ends failed, never stuck', async () => {
    // 1. An automatic grab fails in the client: the chain moves on and queues the next search
    await expect(handleClientReportedFailure(input())).resolves.toBe('next_release');
    // 2. That search finds nothing usable and ends the request failed, with no newer download row
    state.requestStatus = 'failed';
    // 3. Retry download sees the same download alive in the client: request `downloading`, a
    //    hand-picked monitor of the same row (no clientFailures), which the monitor marks failed
    state.requestStatus = 'downloading';
    state.history['dh-1'] = 'failed';
    // 4. The same download fails again
    await expect(handleClientReportedFailure(input({ clientFailures: undefined }))).resolves.toBe('failed');

    expect(state.requestStatus).toBe('failed');
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
    expect(notifications()).toEqual([
      'Download failed in SABnzbd. Trying another release (attempt 2 of 3).',
      'Download failed in SABnzbd',
    ]);

    // A rerun of that last run changes nothing and sends nothing
    await expect(handleClientReportedFailure(input({ clientFailures: undefined }))).resolves.toBe('already_handled');
    expect(notifications()).toHaveLength(2);
  });
});
