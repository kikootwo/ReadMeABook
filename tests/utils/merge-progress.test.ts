/**
 * Component: Chapter Merge Progress Reporter tests (#216)
 * Documentation: documentation/features/chapter-merging.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateMany = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ prisma: { request: { updateMany } } }));

import {
  MERGE_PROGRESS_WRITE_INTERVAL_MS,
  createMergeProgressReporter,
  resetInterruptedMergeProgress,
} from '@/lib/utils/merge-progress';

const written = () => updateMany.mock.calls.map((c) => c[0].data.progress);

/** A clock the test moves together with the fake timers. */
function clock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: async (ms: number) => {
      t += ms;
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  updateMany.mockReset();
  updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('merge progress reporter', () => {
  it('writes the first value at once, only on a processing request that is not deleted', async () => {
    const c = clock();
    const reporter = createMergeProgressReporter('req-1', undefined, c.now);

    reporter.report(0);
    await reporter.settle();

    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'req-1', status: 'processing', deletedAt: null },
      data: { progress: 0, updatedAt: expect.any(Date) },
    });
  });

  it('within the interval holds changes back and writes the newest when it ends', async () => {
    const c = clock();
    const reporter = createMergeProgressReporter('req-1', undefined, c.now);

    reporter.report(0);
    await c.advance(1000);
    reporter.report(3);
    reporter.report(5);
    await c.advance(MERGE_PROGRESS_WRITE_INTERVAL_MS - 1001);
    expect(written()).toEqual([0]);

    await c.advance(1);
    expect(written()).toEqual([0, 5]);
  });

  it('after the interval writes a changed value at once and never an unchanged one', async () => {
    const c = clock();
    const reporter = createMergeProgressReporter('req-1', undefined, c.now);

    reporter.report(10);
    await c.advance(MERGE_PROGRESS_WRITE_INTERVAL_MS);
    reporter.report(10);
    await c.advance(MERGE_PROGRESS_WRITE_INTERVAL_MS * 3);
    reporter.report(11);
    await vi.advanceTimersByTimeAsync(0);

    expect(written()).toEqual([10, 11]);
  });

  it('writes 100 at once, behind the write in flight: the last write is 100', async () => {
    const c = clock();
    let release!: () => void;
    updateMany.mockImplementationOnce(() => new Promise((r) => { release = () => r({ count: 1 }); }));
    const reporter = createMergeProgressReporter('req-1', undefined, c.now);

    reporter.report(42); // slow write
    reporter.report(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(written()).toEqual([42]); // 100 waits for it

    release();
    await reporter.settle();
    expect(written()).toEqual([42, 100]);
  });

  it('is closed after 100: later progress (ffmpeg after a timeout kill) writes nothing', async () => {
    const c = clock();
    const reporter = createMergeProgressReporter('req-1', undefined, c.now);

    reporter.report(0);
    await c.advance(MERGE_PROGRESS_WRITE_INTERVAL_MS + 1);
    reporter.report(25);
    reporter.report(100);
    reporter.report(87);
    await c.advance(MERGE_PROGRESS_WRITE_INTERVAL_MS * 2);
    reporter.report(90);
    await reporter.settle();

    expect(written()).toEqual([0, 25, 100]);
  });

  it('a value held back by the interval is dropped by the 100, never written after it', async () => {
    const c = clock();
    const reporter = createMergeProgressReporter('req-1', undefined, c.now);

    reporter.report(0);
    reporter.report(60); // held back
    reporter.report(100);
    await c.advance(MERGE_PROGRESS_WRITE_INTERVAL_MS * 2);

    expect(written()).toEqual([0, 100]);
  });

  it('settle writes 100 when a lower value was written, waits for it and closes the reporter', async () => {
    const c = clock();
    const reporter = createMergeProgressReporter('req-1', undefined, c.now);

    reporter.report(30);
    await reporter.settle();
    reporter.report(40);
    await c.advance(MERGE_PROGRESS_WRITE_INTERVAL_MS * 2);

    expect(written()).toEqual([30, 100]);
  });

  it('settle writes nothing when no merge reported (single file, merge off or skipped)', async () => {
    const reporter = createMergeProgressReporter('req-1');
    await reporter.settle();
    reporter.report(0);
    await reporter.settle();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('a failed write is logged and dropped; the next write still runs and settle resolves', async () => {
    const c = clock();
    const warn = vi.fn();
    updateMany.mockRejectedValueOnce(new Error('connection lost'));
    const reporter = createMergeProgressReporter('req-1', { warn }, c.now);

    reporter.report(5);
    reporter.report(100);
    await expect(reporter.settle()).resolves.toBeUndefined();

    expect(written()).toEqual([5, 100]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('connection lost'));
  });

  it('settle issues the final 100 once more when it failed, so the bar never outlives ffmpeg', async () => {
    const c = clock();
    const warn = vi.fn();
    updateMany.mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error('pool timeout'));
    const reporter = createMergeProgressReporter('req-1', { warn }, c.now);

    reporter.report(37);
    reporter.report(100); // rejected
    await reporter.settle();

    expect(written()).toEqual([37, 100, 100]);
    expect(updateMany.mock.calls[2][0].where).toEqual({ id: 'req-1', status: 'processing', deletedAt: null });
  });

  it('the 100 settle writes itself is issued again too, but only once', async () => {
    const c = clock();
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('pool timeout'))
      .mockRejectedValueOnce(new Error('pool timeout'));
    const reporter = createMergeProgressReporter('req-1', { warn: vi.fn() }, c.now);

    reporter.report(37);
    await expect(reporter.settle()).resolves.toBeUndefined(); // 100 rejected, retried, rejected again
    await reporter.settle();

    expect(written()).toEqual([37, 100, 100]);
  });

  it('clamps and floors what it is given', async () => {
    const c = clock();
    const reporter = createMergeProgressReporter('req-1', undefined, c.now);
    reporter.report(-3);
    await c.advance(MERGE_PROGRESS_WRITE_INTERVAL_MS);
    reporter.report(Number.NaN);
    reporter.report(41.9);
    reporter.report(250);
    await reporter.settle();
    expect(written()).toEqual([0, 41, 100]);
  });
});

describe('boot reset', () => {
  it('puts every processing request below 100 back to 100', async () => {
    updateMany.mockResolvedValueOnce({ count: 2 });
    await expect(resetInterruptedMergeProgress()).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: 'processing', progress: { lt: 100 } },
      data: { progress: 100 },
    });
  });
});
