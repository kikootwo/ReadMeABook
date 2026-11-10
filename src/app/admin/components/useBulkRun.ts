/**
 * Component: Bulk Run (admin table bulk actions)
 * Documentation: documentation/admin-features/bulk-request-actions.md
 *
 * Runs one action over a fixed list of requests, one at a time: the next call starts only
 * after the previous one answered. Stop (or leaving the page) takes effect after the current
 * request. A failed request does not stop the run. The run owns its list, so a selection
 * change during the run does not change what it acts on.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { runBulkItem, type BulkAction, type BulkItem, type BulkItemOutcome, type BulkSummary } from './bulk-actions';

export interface BulkProgress {
  action: BulkAction;
  total: number;
  finished: number;
  stopping: boolean;
}

export type RunItem = (action: BulkAction, id: string) => Promise<BulkItemOutcome>;

export interface BulkRun {
  running: boolean;
  progress: BulkProgress | null;
  /** Resolves with the summary when the run ends; null when a run is already going */
  start: (action: BulkAction, items: BulkItem[], preSkipped?: BulkSummary['preSkipped']) => Promise<BulkSummary | null>;
  stop: () => void;
}

export function useBulkRun(runItem: RunItem = runBulkItem): BulkRun {
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Leaving the page: nothing new starts; the request in flight finishes on the server
      mountedRef.current = false;
      stopRef.current = true;
    };
  }, []);

  const start = useCallback<BulkRun['start']>(async (action, items, preSkipped = []) => {
    if (runningRef.current) return null;
    runningRef.current = true;
    stopRef.current = false;
    setProgress({ action, total: items.length, finished: 0, stopping: false });
    const outcomes: BulkSummary['outcomes'] = [];
    let next = 0;
    try {
      for (; next < items.length && !stopRef.current; next++) {
        const item = items[next];
        let outcome: BulkItemOutcome;
        try {
          outcome = await runItem(action, item.id);
        } catch (error) {
          outcome = { result: 'failed', reason: error instanceof Error ? error.message : 'the request did not complete' };
        }
        outcomes.push({ ...item, ...outcome });
        const finished = next + 1;
        if (mountedRef.current) setProgress((p) => (p ? { ...p, finished } : p));
      }
    } finally {
      runningRef.current = false;
      if (mountedRef.current) setProgress(null);
    }
    return { action, total: items.length, outcomes, preSkipped, stopped: next < items.length, notStarted: items.slice(next) };
  }, [runItem]);

  const stop = useCallback(() => {
    if (!runningRef.current) return;
    stopRef.current = true;
    setProgress((p) => (p ? { ...p, stopping: true } : p));
  }, []);

  return { running: progress !== null, progress, start, stop };
}
