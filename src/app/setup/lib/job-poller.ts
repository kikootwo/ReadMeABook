/**
 * Component: Setup Job Poller (cancellable)
 * Documentation: documentation/setup-wizard.md
 *
 * Polls /api/admin/job-status/:id for the setup finalize step and the first-
 * login initializing page. Every timer and request it starts is tracked, so
 * leaving the page (cancel) stops everything: pending waits reject, in-flight
 * requests are aborted, and nothing fires or fetches after unmount.
 */

'use client';

import { useEffect, useRef } from 'react';

export const JOB_POLL_INTERVAL_MS = 2000;
/** Longest a single status request may take before it is abandoned (polling then continues). */
export const JOB_STATUS_REQUEST_TIMEOUT_MS = 30_000;

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
  /** Give up with 'failed' after this long, including a request that never answers (default: no limit). */
  timeoutMs?: number;
  /** Console log prefix, e.g. "[Setup]". */
  logPrefix?: string;
}

export interface JobPoller {
  /** Poll until the job completes or fails. Rejects with PollCancelledError once cancelled. */
  pollJobStatus(jobId: string, accessToken: string, options?: PollOptions): Promise<JobOutcome>;
  /** Wait `ms`. Rejects with PollCancelledError once cancelled. */
  delay(ms: number): Promise<void>;
  /** fetch() that is aborted on cancel (rejecting with PollCancelledError). */
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** Throws PollCancelledError once cancelled: check before acting on a result. */
  throwIfCancelled(): void;
  cancel(): void;
  readonly cancelled: boolean;
}

class RequestTimeoutError extends Error {}

export function createJobPoller(): JobPoller {
  let cancelled = false;
  const controller = new AbortController();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const onCancel = new Set<() => void>();

  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  };
  const clearLater = (timer: ReturnType<typeof setTimeout>) => {
    clearTimeout(timer);
    timers.delete(timer);
  };

  const throwIfCancelled = () => {
    if (cancelled) throw new PollCancelledError();
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

  /** fetch bound to the poller's lifetime and, optionally, a per-request time limit. */
  const boundFetch = async (input: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> => {
    throwIfCancelled();
    const request = new AbortController();
    const abortRequest = () => request.abort();
    controller.signal.addEventListener('abort', abortRequest);
    let timedOut = false;
    const timer = timeoutMs !== undefined
      ? later(() => { timedOut = true; request.abort(); }, Math.max(0, timeoutMs))
      : undefined;
    // Settle on abort even if a fetch implementation ignores the signal
    const aborted = new Promise<never>((_, reject) => {
      request.signal.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true });
    });
    try {
      return await Promise.race([fetch(input, { ...init, signal: request.signal }), aborted]);
    } catch (error) {
      if (cancelled) throw new PollCancelledError();
      if (timedOut) throw new RequestTimeoutError(`Request timed out after ${timeoutMs} ms`);
      throw error;
    } finally {
      if (timer !== undefined) clearLater(timer);
      controller.signal.removeEventListener('abort', abortRequest);
    }
  };

  const pollJobStatus = async (jobId: string, accessToken: string, options: PollOptions = {}): Promise<JobOutcome> => {
    const prefix = options.logPrefix ?? '[Setup]';
    const deadline = options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : Infinity;
    console.log(`${prefix} Polling job status for: ${jobId}`);

    for (;;) {
      await delay(JOB_POLL_INTERVAL_MS);
      const timeLeft = deadline - Date.now();
      if (timeLeft <= 0) return 'failed';
      try {
        const response = await boundFetch(
          `/api/admin/job-status/${jobId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          Math.min(timeLeft, JOB_STATUS_REQUEST_TIMEOUT_MS)
        );
        if (!response.ok) {
          console.error(`${prefix} Failed to fetch job status: ${response.status}`);
          return 'failed';
        }
        const data = await response.json();
        throwIfCancelled();
        const jobStatus = data.job.status;
        console.log(`${prefix} Job ${jobId} status: ${jobStatus}`);
        if (jobStatus === 'completed') return 'completed';
        if (jobStatus === 'failed') return 'failed';
        // Otherwise keep polling (pending, active, stuck)
      } catch (error) {
        if (isPollCancelled(error)) throw error;
        if (error instanceof RequestTimeoutError) {
          // One unanswered request: try again until the overall deadline (checked above)
          console.warn(`${prefix} Job status request timed out; retrying`);
          continue;
        }
        console.error(`${prefix} Error polling job status:`, error);
        return 'failed';
      }
    }
  };

  return {
    pollJobStatus,
    delay,
    fetch: (input, init) => boundFetch(input, init),
    throwIfCancelled,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      controller.abort();
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

export interface JobPollerHandle extends Pick<JobPoller, 'pollJobStatus' | 'delay'> {
  /**
   * The poller for the current mount. Take it once when a run starts and use it for the whole
   * run, so a run begun before a StrictMode remount stops with that mount's poller.
   */
  session(): JobPoller;
}

/**
 * A poller cancelled when the component unmounts. The returned handle is
 * stable; under StrictMode's simulated unmount a fresh poller takes over.
 */
export function useJobPoller(): JobPollerHandle {
  const pollerRef = useRef<JobPoller | null>(null);
  const handleRef = useRef<JobPollerHandle | null>(null);
  if (!pollerRef.current) pollerRef.current = createJobPoller();
  if (!handleRef.current) {
    handleRef.current = {
      session: () => pollerRef.current!,
      pollJobStatus: (...args) => pollerRef.current!.pollJobStatus(...args),
      delay: (ms) => pollerRef.current!.delay(ms),
    };
  }

  useEffect(() => {
    if (!pollerRef.current || pollerRef.current.cancelled) pollerRef.current = createJobPoller();
    const poller = pollerRef.current;
    return () => poller.cancel();
  }, []);

  return handleRef.current;
}
