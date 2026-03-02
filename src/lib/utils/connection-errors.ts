/**
 * Component: Connection Error Classification Utility
 * Documentation: documentation/phase3/README.md
 *
 * Classifies errors as transient connection failures (e.g. download client
 * restarting, network blip) vs permanent failures.  Used by download
 * processors to decide whether to retry with backoff or fail immediately.
 */

/** Node/Axios error codes that indicate the remote service is temporarily unreachable. */
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'EAI_AGAIN',
]);

/** HTTP status codes that indicate a gateway / upstream service issue. */
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);

/**
 * Substrings in error messages that strongly indicate a connection-level
 * failure.  Checked as a fallback when structured error properties are
 * unavailable (e.g. errors re-thrown as plain Error with a message string).
 */
const TRANSIENT_MESSAGE_PATTERNS = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'EAI_AGAIN',
  'connect ECONNREFUSED',
  'socket hang up',
  'network error',
  'Client network socket disconnected',
] as const;

/**
 * Returns `true` when the error looks like a transient connection failure
 * rather than a permanent / logical error.
 *
 * Checks (in order):
 *  1. `error.code`  — Node.js / Axios error codes
 *  2. `error.response.status` — HTTP gateway errors (502/503/504)
 *  3. `error.message` — fallback substring matching
 */
export function isTransientConnectionError(error: unknown): boolean {
  if (!error) return false;

  // 1. Structured error code (Node.js / Axios)
  const code = (error as any)?.code;
  if (typeof code === 'string' && TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }

  // 2. HTTP gateway status from Axios response
  const status = (error as any)?.response?.status;
  if (typeof status === 'number' && TRANSIENT_HTTP_STATUSES.has(status)) {
    return true;
  }

  // 3. Fallback: substring match on the error message
  const message = (error instanceof Error ? error.message : String(error)).toUpperCase();
  for (const pattern of TRANSIENT_MESSAGE_PATTERNS) {
    if (message.includes(pattern.toUpperCase())) {
      return true;
    }
  }

  return false;
}
