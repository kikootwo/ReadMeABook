/**
 * Component: Startup Initialization Constants
 * Documentation: documentation/backend/services/scheduler.md
 */

/** Internal route that runs one-time service initialization (scheduler, credential migration) */
export const STARTUP_INIT_PATH = '/api/init';

/** Header carrying the per-process startup secret */
export const STARTUP_TOKEN_HEADER = 'x-rmab-startup-token';

/** Random bytes in the per-process startup secret */
export const STARTUP_SECRET_BYTES = 32;

/** First retry delay for the startup init loop (ms) */
export const STARTUP_RETRY_BASE_MS = 1000;

/** Retry delay cap for the startup init loop (ms); the loop never gives up */
export const STARTUP_RETRY_MAX_MS = 60_000;

/** Per-attempt timeout for one init call (ms); init itself may take a while */
export const STARTUP_ATTEMPT_TIMEOUT_MS = 120_000;

/** Readiness probe timeout for Redis (ms) */
export const STARTUP_REDIS_PING_TIMEOUT_MS = 3000;

/** Log an error-level reminder every N failed attempts once the delay is capped */
export const STARTUP_ERROR_LOG_EVERY = 10;
