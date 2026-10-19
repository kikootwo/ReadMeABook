/**
 * Component: Per-process Startup Secret
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Generated in memory by the instrumentation hook and checked by the init
 * route. Kept as a process-wide singleton so every module copy in the same
 * process sees it. Never logged, never put in env, never written to disk.
 */

import { randomBytes, timingSafeEqual } from 'crypto';
import { STARTUP_SECRET_BYTES } from '@/lib/constants/startup';
import { peekProcessSingleton, processSingleton } from '@/lib/utils/process-singleton';

const SECRET_KEY = 'startup-secret';

/** Return this process's startup secret, creating it on first use. */
export function getOrCreateStartupSecret(): string {
  return processSingleton(SECRET_KEY, () => randomBytes(STARTUP_SECRET_BYTES).toString('hex'));
}

/** True only when a secret exists in this process and `candidate` matches it. */
export function isStartupSecret(candidate: string | null | undefined): boolean {
  const secret = peekProcessSingleton<string>(SECRET_KEY);
  if (!secret || typeof candidate !== 'string') return false;
  const expected = Buffer.from(secret, 'utf8');
  const received = Buffer.from(candidate, 'utf8');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
