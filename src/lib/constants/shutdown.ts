/**
 * Component: App Shutdown Constants
 * Documentation: documentation/deployment/unified.md
 *
 * Sized for Docker's and Unraid's default 10 s stop timeout: node is done within
 * the hard deadline, which leaves Redis and PostgreSQL time to stop cleanly.
 * supervisord's [program:app] stopwaitsecs must stay above the hard deadline
 * (tests/docker/supervisord-config.test.ts checks it).
 */

/** Node exits with code 1 at this point, whatever is still running (ms after the signal) */
export const SHUTDOWN_HARD_DEADLINE_MS = 5000;

/** Running jobs and open HTTP requests may finish until this point (ms after the signal) */
export const SHUTDOWN_DRAIN_MS = 3500;

/** Limit for each later step: queue close, job-row writes, disconnects (ms) */
export const SHUTDOWN_STEP_LIMIT_MS = 500;
