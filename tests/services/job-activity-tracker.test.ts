/**
 * Component: Job Activity Tracker Tests
 * Documentation: documentation/backend/services/jobs.md
 */

import { describe, expect, it, vi } from 'vitest';
import { createQueueShutdownTarget, JobActivityTracker } from '@/lib/services/job-activity-tracker';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('JobActivityTracker', () => {
  it('counts a job as running until its handler settles (resolve or reject)', async () => {
    const tracker = new JobActivityTracker();
    const a = deferred();
    const b = deferred();
    tracker.trackActive({ id: 1, name: 'organize_files', data: { requestId: 'req-1' } }, a.promise);
    tracker.trackActive({ id: 2, name: 'search_indexers', data: {} }, b.promise);

    expect(tracker.activeJobs()).toEqual([
      { id: '1', name: 'organize_files', requestId: 'req-1' },
      { id: '2', name: 'search_indexers' },
    ]);

    a.resolve();
    b.reject(new Error('boom'));
    await Promise.allSettled([a.promise, b.promise]);
    await Promise.resolve();

    expect(tracker.activeJobs()).toEqual([]);
  });

  it('ignores an active event without a handler promise or a job', () => {
    const tracker = new JobActivityTracker();
    tracker.trackActive({ id: 1, name: 'organize_files' }, undefined);
    tracker.trackActive(null, Promise.resolve());
    expect(tracker.activeJobs()).toEqual([]);
  });

  it('finds running jobs of the given types for a request', () => {
    const tracker = new JobActivityTracker();
    tracker.trackActive({ id: 1, name: 'organize_files', data: { requestId: 'req-1' } }, deferred().promise);
    tracker.trackActive({ id: 2, name: 'monitor_download', data: { requestId: 'req-1' } }, deferred().promise);
    tracker.trackActive({ id: 3, name: 'organize_files', data: { requestId: 'req-2' } }, deferred().promise);

    expect(tracker.activeForRequest('req-1', ['organize_files', 'start_direct_download']).map((j) => j.id)).toEqual(['1']);
    expect(tracker.activeForRequest('req-3', ['organize_files'])).toEqual([]);
  });

  it('flushes pending writes, including writes started while flushing', async () => {
    const tracker = new JobActivityTracker();
    const first = deferred();
    const second = deferred();
    tracker.trackWrite(first.promise);

    let flushed = false;
    const flush = tracker.flushWrites().then(() => {
      flushed = true;
    });

    tracker.trackWrite(second.promise);
    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(flushed).toBe(false);

    second.reject(new Error('write failed'));
    await flush;
    expect(flushed).toBe(true);
  });

  it('builds the stop API on the Bull queue without waiting for active jobs on pause', async () => {
    const queue = {
      pause: vi.fn().mockResolvedValue(undefined),
      whenCurrentJobsFinished: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const redis = { disconnect: vi.fn() };
    const target = createQueueShutdownTarget(queue as never, redis as never, new JobActivityTracker());

    await target.pauseLocal();
    await target.whenCurrentJobsFinished();
    await target.close();
    target.disconnect();

    expect(queue.pause).toHaveBeenCalledWith(true, true);
    expect(queue.whenCurrentJobsFinished).toHaveBeenCalled();
    expect(queue.close).toHaveBeenCalledWith();
    expect(redis.disconnect).toHaveBeenCalled();
  });
});
