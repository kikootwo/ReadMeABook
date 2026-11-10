/**
 * Component: Process Stopping Flag
 * Documentation: documentation/backend/services/jobs.md
 *
 * Set once by the shutdown coordinator when SIGTERM/SIGINT arrives. Kept on
 * globalThis so every bundled copy of this module sees the same flag. The job
 * queue checks it so a queue created during the stop never starts workers.
 */

const SLOT = Symbol.for('rmab.process.stopping');
const store = globalThis as unknown as Record<symbol, boolean | undefined>;

export function markProcessStopping(): void {
  store[SLOT] = true;
}

export function isProcessStopping(): boolean {
  return store[SLOT] === true;
}
