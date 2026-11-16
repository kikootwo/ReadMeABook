/**
 * Component: Job Queued Error Marker
 * Documentation: documentation/backend/services/jobs.md
 *
 * Marks an error thrown by the job queue after the Bull job was already added (the job will
 * run; only the follow-up write of its Bull ID failed). The error object is rethrown unchanged,
 * so callers that do not ask see exactly the error they always did.
 */

const queuedBeforeError = new WeakSet<object>();

/** Records that the job behind `error` was added to the queue before `error` was thrown. */
export function markJobQueued(error: unknown): void {
  if (typeof error === 'object' && error !== null) queuedBeforeError.add(error);
}

/** True when the job queue threw `error` after the job was added (the job runs). */
export function jobWasQueued(error: unknown): boolean {
  return typeof error === 'object' && error !== null && queuedBeforeError.has(error);
}
