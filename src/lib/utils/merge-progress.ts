/**
 * Component: Chapter Merge Progress Reporter (#216)
 * Documentation: documentation/features/chapter-merging.md
 *
 * Writes a processing request's chapter merge progress to `request.progress`:
 * 0-99 while the merge's ffmpeg runs, 100 the moment it exits. The contract
 * ("processing means progress 100, except during the merge") is documented at
 * `requestPhase` in src/lib/constants/request-statuses.ts.
 */

import { prisma } from '../db';
import { RMABLogger } from './logger';

/** At most one write per this interval between the first value and the final 100. */
export const MERGE_PROGRESS_WRITE_INTERVAL_MS = 10_000;

export interface MergeProgressReporter {
  /** A merge percent (0-100). 100 is written at once and closes the reporter. */
  report(percent: number): void;
  /** Writes 100 if a lower value was written, closes the reporter and waits for the last write. */
  settle(): Promise<void>;
}

type Logger = Pick<RMABLogger, 'warn'>;

/**
 * Per-request reporter. The first value and 100 are written at once; in between,
 * a changed percent is written at most once per MERGE_PROGRESS_WRITE_INTERVAL_MS
 * (the newest value is written when the interval ends). Writes run one at a time,
 * only while the request is `processing` and not deleted, and a write error is
 * logged and dropped. Once closed (100 or settle) every later call does nothing.
 */
export function createMergeProgressReporter(
  requestId: string,
  logger?: Logger,
  now: () => number = Date.now
): MergeProgressReporter {
  let closed = false;
  let lastWritten: number | null = null;
  let lastWriteAt = 0;
  let pending: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const write = async (percent: number): Promise<void> => {
    try {
      await prisma.request.updateMany({
        where: { id: requestId, status: 'processing', deletedAt: null },
        data: { progress: percent, updatedAt: new Date() },
      });
    } catch (error) {
      logger?.warn(`Could not save merge progress (${percent}%): ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const enqueue = (percent: number): void => {
    lastWritten = percent;
    lastWriteAt = now();
    chain = chain.then(() => write(percent));
  };

  const clearPending = (): void => {
    pending = null;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const flushPending = (): void => {
    timer = null;
    const value = pending;
    pending = null;
    if (!closed && value !== null && value !== lastWritten) enqueue(value);
  };

  const close = (finalWrite: boolean): void => {
    closed = true;
    clearPending();
    if (finalWrite) enqueue(100);
  };

  return {
    report(percent: number): void {
      if (closed || !Number.isFinite(percent)) return;
      const value = Math.max(0, Math.min(100, Math.floor(percent)));
      if (value === 100) {
        close(true);
        return;
      }
      if (value === lastWritten) {
        clearPending();
        return;
      }
      if (lastWritten === null || now() - lastWriteAt >= MERGE_PROGRESS_WRITE_INTERVAL_MS) {
        clearPending();
        enqueue(value);
        return;
      }
      pending = value;
      if (!timer) {
        timer = setTimeout(flushPending, Math.max(0, lastWriteAt + MERGE_PROGRESS_WRITE_INTERVAL_MS - now()));
        timer.unref?.();
      }
    },

    async settle(): Promise<void> {
      if (!closed) close(lastWritten !== null);
      await chain;
    },
  };
}

/**
 * Boot step: a merge cannot outlive the process (ffmpeg is its child), so a
 * processing request below 100 was cut mid-merge. Puts it back to 100 so no
 * card shows a frozen percent. Returns how many requests were reset.
 */
export async function resetInterruptedMergeProgress(): Promise<number> {
  const { count } = await prisma.request.updateMany({
    where: { status: 'processing', progress: { lt: 100 } },
    data: { progress: 100 },
  });
  return count;
}
