/**
 * Component: Bulk Run Hook Tests
 * Documentation: documentation/admin-features/bulk-request-actions.md
 *
 * One request at a time, in order; Stop after the current request; a failed request does
 * not stop the run; the summary reports done, skipped, failed and not started.
 */

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBulkRun, type RunItem } from '@/app/admin/components/useBulkRun';
import type { BulkItemOutcome } from '@/app/admin/components/bulk-actions';

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, title: `Made Up ${i}` }));

/** A runner whose calls the test answers one by one. */
function controlledRunner() {
  const calls: { id: string; resolve: (o: BulkItemOutcome) => void }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const run: RunItem = (_action, id) => new Promise((resolve) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    calls.push({ id, resolve: (o) => { inFlight--; resolve(o); } });
  });
  return { run, calls, maxInFlight: () => maxInFlight };
}

describe('useBulkRun', () => {
  it('runs the list in order, one request at a time, with per-item progress', async () => {
    const runner = controlledRunner();
    const { result } = renderHook(() => useBulkRun(runner.run));
    let done!: Promise<unknown>;
    act(() => { done = result.current.start('delete', items(3)); });
    await waitFor(() => expect(runner.calls).toHaveLength(1));
    expect(result.current.running).toBe(true);
    expect(result.current.progress).toMatchObject({ action: 'delete', total: 3, finished: 0 });

    await act(async () => runner.calls[0].resolve({ result: 'done' }));
    await waitFor(() => expect(runner.calls).toHaveLength(2));
    expect(result.current.progress?.finished).toBe(1);
    await act(async () => runner.calls[1].resolve({ result: 'failed', reason: 'boom' }));
    await waitFor(() => expect(runner.calls).toHaveLength(3));
    await act(async () => runner.calls[2].resolve({ result: 'skipped', reason: 'no longer exists' }));

    const summary = await done;
    expect(runner.calls.map((c) => c.id)).toEqual(['id-0', 'id-1', 'id-2']);
    expect(runner.maxInFlight()).toBe(1);
    expect(summary).toEqual({
      action: 'delete',
      total: 3,
      outcomes: [
        { id: 'id-0', title: 'Made Up 0', result: 'done' },
        { id: 'id-1', title: 'Made Up 1', result: 'failed', reason: 'boom' },
        { id: 'id-2', title: 'Made Up 2', result: 'skipped', reason: 'no longer exists' },
      ],
      preSkipped: [],
      stopped: false,
      notStarted: [],
    });
    expect(result.current.running).toBe(false);
  });

  it('Stop takes effect after the current request; the rest are not started', async () => {
    const runner = controlledRunner();
    const { result } = renderHook(() => useBulkRun(runner.run));
    let done!: Promise<unknown>;
    act(() => { done = result.current.start('cancel', items(4)); });
    await waitFor(() => expect(runner.calls).toHaveLength(1));
    await act(async () => runner.calls[0].resolve({ result: 'done' }));
    await waitFor(() => expect(runner.calls).toHaveLength(2));
    act(() => result.current.stop());
    expect(result.current.progress?.stopping).toBe(true);
    await act(async () => runner.calls[1].resolve({ result: 'done' }));
    const summary = (await done) as { stopped: boolean; outcomes: unknown[]; notStarted: { id: string }[] };
    expect(runner.calls).toHaveLength(2);
    expect(summary.stopped).toBe(true);
    expect(summary.outcomes).toHaveLength(2);
    expect(summary.notStarted.map((i) => i.id)).toEqual(['id-2', 'id-3']);
  });

  it('a runner that throws is a failed item and the run goes on', async () => {
    const run = vi.fn<RunItem>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ result: 'done' });
    const { result } = renderHook(() => useBulkRun(run));
    let summary: unknown;
    await act(async () => { summary = await result.current.start('approve', items(2), [{ id: 'x', title: 'X', result: 'skipped', reason: 'not waiting for approval' }]); });
    expect(summary).toMatchObject({
      outcomes: [{ id: 'id-0', result: 'failed', reason: 'no answer from RMAB' }, { id: 'id-1', result: 'done' }],
      preSkipped: [{ id: 'x', result: 'skipped' }],
      stopped: false,
    });
  });

  it('a second start while running is refused', async () => {
    const runner = controlledRunner();
    const { result } = renderHook(() => useBulkRun(runner.run));
    let first!: Promise<unknown>;
    act(() => { first = result.current.start('delete', items(1)); });
    let second: unknown = 'unset';
    await act(async () => { second = await result.current.start('delete', items(1)); });
    expect(second).toBeNull();
    await act(async () => runner.calls[0].resolve({ result: 'done' }));
    await first;
    expect(runner.calls).toHaveLength(1);
  });

  it('leaving the page starts nothing new after the request in flight', async () => {
    const runner = controlledRunner();
    const { result, unmount } = renderHook(() => useBulkRun(runner.run));
    let done!: Promise<unknown>;
    act(() => { done = result.current.start('delete', items(3)); });
    await waitFor(() => expect(runner.calls).toHaveLength(1));
    unmount();
    runner.calls[0].resolve({ result: 'done' });
    const summary = (await done) as { notStarted: unknown[] };
    expect(runner.calls).toHaveLength(1);
    expect(summary.notStarted).toHaveLength(2);
  });
});
