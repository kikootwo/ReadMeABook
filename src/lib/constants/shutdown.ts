/**
 * Component: App Shutdown Constants
 * Documentation: documentation/deployment/unified.md
 *
 * Sized for Docker's and Unraid's default 10 s stop timeout. The drain plus three
 * step limits end before the hard deadline, so every step's warning prints. The
 * deadline runs on node's event loop; docker/unified/app-start.sh SIGKILLs node at
 * APP_STOP_KILL_AFTER (6 s) by wall clock, and supervisord's [program:app]
 * stopwaitsecs (8) is the last backstop, which leaves Redis and PostgreSQL at least
 * 2 s of a 10 s stop (tests/docker/supervisord-config.test.ts checks the order).
 */

/** Node exits with code 1 at this point, whatever is still running (ms after the signal) */
export const SHUTDOWN_HARD_DEADLINE_MS = 5000;

/** Running jobs and open HTTP requests may finish until this point (ms after the signal) */
export const SHUTDOWN_DRAIN_MS = 3500;

/** Limit for each later step: queue close, job-row writes, disconnects (ms) */
export const SHUTDOWN_STEP_LIMIT_MS = 400;
