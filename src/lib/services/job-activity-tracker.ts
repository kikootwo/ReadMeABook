/**
 * Component: Job Activity Tracker (in-process running jobs, pending job-row writes, stop API)
 * Documentation: documentation/backend/services/jobs.md
 *
 * Bull's local 'active' event hands over the handler's promise, so a job counts as
 * running here until its handler settles. The shutdown coordinator reads this to
 * drain and to name the jobs it leaves for the stall retry; the stall-limit
 * failure handler reads it to leave a request alone while its job still runs.
 */

import type { Queue } from 'bull';
import type Redis from 'ioredis';

/** Process-singleton key of the job queue service (peeked by the shutdown coordinator) */
export const JOB_QUEUE_SINGLETON_KEY = 'job-queue-service';

export interface ActiveJobInfo {
  id: string;
  name: string;
  requestId?: string;
}

/** What the shutdown coordinator may do with the job queue, and nothing more */
export interface QueueShutdownTarget {
  /** Stop taking new jobs in this process; running jobs carry on */
  pauseLocal(): Promise<void>;
  /** Resolves when the jobs running in this process have finished and been recorded in Redis */
  whenCurrentJobsFinished(): Promise<void>;
  activeJobs(): ActiveJobInfo[];
  /** Close the Bull connections (only called when nothing is running) */
  close(): Promise<void>;
  /** Wait for the jobs-table writes started by queue events */
  flushJobWrites(): Promise<void>;
  /** Drop the service's own Redis connection */
  disconnect(): void;
}

interface JobLike {
  id?: unknown;
  name?: string;
  data?: { requestId?: unknown } | null;
}

export class JobActivityTracker {
  private readonly running = new Map<string, ActiveJobInfo>();
  private readonly writes = new Set<Promise<unknown>>();

  /** Count `job` as running until `handler` settles (Bull's local 'active' event passes both). */
  trackActive(job: JobLike | null | undefined, handler: unknown): void {
    if (!job || job.id === undefined || !handler || typeof (handler as Promise<unknown>).then !== 'function') return;
    const id = String(job.id);
    const requestId = typeof job.data?.requestId === 'string' ? job.data.requestId : undefined;
    const info: ActiveJobInfo = { id, name: job.name ?? 'unknown', ...(requestId ? { requestId } : {}) };
    this.running.set(id, info);
    const done = () => {
      if (this.running.get(id) === info) this.running.delete(id);
    };
    (handler as Promise<unknown>).then(done, done);
  }

  activeJobs(): ActiveJobInfo[] {
    return [...this.running.values()];
  }

  /** Jobs of the given types running here for `requestId` */
  activeForRequest(requestId: string, names: readonly string[]): ActiveJobInfo[] {
    return this.activeJobs().filter((job) => job.requestId === requestId && names.includes(job.name));
  }

  /** Remember a write until it settles; returns the same promise */
  trackWrite<T>(write: Promise<T>): Promise<T> {
    this.writes.add(write);
    const done = () => {
      this.writes.delete(write);
    };
    write.then(done, done);
    return write;
  }

  /** Wait until every tracked write (including ones started meanwhile) has settled */
  async flushWrites(): Promise<void> {
    while (this.writes.size > 0) {
      await Promise.allSettled([...this.writes]);
    }
  }
}

export function createQueueShutdownTarget(queue: Queue, redis: Redis, activity: JobActivityTracker): QueueShutdownTarget {
  return {
    // Local pause without waiting: a later close() can't be escalated, and close(false) waits with no limit
    pauseLocal: () => queue.pause(true, true),
    whenCurrentJobsFinished: () => queue.whenCurrentJobsFinished(),
    activeJobs: () => activity.activeJobs(),
    close: () => queue.close(),
    flushJobWrites: () => activity.flushWrites(),
    disconnect: () => redis.disconnect(),
  };
}
