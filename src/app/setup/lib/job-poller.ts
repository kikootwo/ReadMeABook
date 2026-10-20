/**
 * Component: Setup Job Poller (cancellable)
 * Documentation: documentation/setup-wizard.md
 *
 * Polls /api/admin/job-status/:id for the setup finalize step and the first-
 * login initializing page. Every timer it starts is tracked, so leaving the
 * page (cancel) stops polling: nothing keeps fetching or fires after unmount.
 */

'use client';

import { useEffect, useRef } from 'react';

export const JOB_POLL_INTERVAL_MS = 2000;

export type JobOutcome = 'completed' | 'failed';

/** Thrown into awaiting callers once the poller is cancelled; callers just stop. */
export class PollCancelledError extends Error {
  constructor() {
    super('Job polling cancelled');
    this.name = 'PollCancelledError';
  }
}

export const isPollCancelled = (error: unknown): boolean => error instanceof PollCancelledError;

export interface PollOptions {
  /** Give up with 'failed' after this long (default: no limit). */
  timeoutMs?: number;
  /** Console log prefix, e.g. "[Setup]". */
  logPrefix?: string;
}

export interface JobPoller {
  /** Poll until the job completes or fails. Rejects with PollCancelledError once cancelled. */
  pollJobStatus(jobId: string, accessToken: string, options?: PollOptions): Promise<JobOutcome>;
  /** Wait `ms`. Rejects with PollCancelledError once cancelled. */
  delay(ms: number): Promise<void>;
  cancel(): void;
  readonly cancelled: boolean;
}

export function createJobPoller(): JobPoller {
  let cancelled = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const onCancel = new Set<() => void>();

  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };

  const delay = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (cancelled) return reject(new PollCancelledError());
      const abort = () => reject(new PollCancelledError());
      onCancel.add(abort);
      later(() => {
        onCancel.delete(abort);
        resolve();
      }, ms);
    });

  const pollJobStatus = async (jobId: string, accessToken: string, options: PollOptions = {}): Promise<JobOutcome> => {
    const prefix = options.logPrefix ?? '[Setup]';
    const deadline = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : Infinity;
    console.log(`${prefix} Polling job status for: ${jobId}`);

    for (;;) {
      await delay(JOB_POLL_INTERVAL_MS);
      if (Date.now() >= deadline) return 'failed';
      try {
        const response = await fetch(`/api/admin/job-status/${jobId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (cancelled) throw new PollCancelledError();
        if (!response.ok) {
          console.error(`${prefix} Failed to fetch job status: ${response.status}`);
          return 'failed';
        }
        const data = await response.json();
        const jobStatus = data.job.status;
        console.log(`${prefix} Job ${jobId} status: ${jobStatus}`);
        if (jobStatus === 'completed') return 'completed';
        if (jobStatus === 'failed') return 'failed';
        // Otherwise keep polling (pending, active, stuck)
      } catch (error) {
        if (isPollCancelled(error)) throw error;
        console.error(`${prefix} Error polling job status:`, error);
        return 'failed';
      }
    }
  };

  return {
    pollJobStatus,
    delay,
    cancel() {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const abort of onCancel) abort();
      onCancel.clear();
    },
    get cancelled() {
      return cancelled;
    },
  };
}

/**
 * A poller cancelled when the component unmounts. The returned object is
 * stable; under StrictMode's simulated unmount a fresh poller takes over.
 */
export function useJobPoller(): Pick<JobPoller, 'pollJobStatus' | 'delay'> {
  const pollerRef = useRef<JobPoller | null>(null);
  const facadeRef = useRef<Pick<JobPoller, 'pollJobStatus' | 'delay'> | null>(null);
  if (!pollerRef.current) pollerRef.current = createJobPoller();
  if (!facadeRef.current) {
    facadeRef.current = {
      pollJobStatus: (...args) => pollerRef.current!.pollJobStatus(...args),
      delay: (ms) => pollerRef.current!.delay(ms),
    };
  }

  useEffect(() => {
    if (!pollerRef.current || pollerRef.current.cancelled) pollerRef.current = createJobPoller();
    const poller = pollerRef.current;
    return () => poller.cancel();
  }, []);

  return facadeRef.current;
}
