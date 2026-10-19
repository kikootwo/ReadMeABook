/**
 * Component: Startup Init Trigger (runs from instrumentation register())
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Calls the app's own init route over loopback with the per-process secret,
 * so initialization (scheduler, job processors) runs in the same module graph as
 * the route handlers that invalidate settings caches. Retries with capped backoff
 * until one 200. Fire-and-forget: Next awaits register(), so it must not block.
 * Deliberately dependency-light: no Prisma/logger imports here.
 */

import { isIP } from 'net';
import {
  STARTUP_ATTEMPT_TIMEOUT_MS,
  STARTUP_ERROR_LOG_EVERY,
  STARTUP_INIT_PATH,
  STARTUP_RETRY_BASE_MS,
  STARTUP_RETRY_MAX_MS,
  STARTUP_TOKEN_HEADER,
} from '@/lib/constants/startup';
import { getOrCreateStartupSecret } from './startup-secret';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const WILDCARD_HOSTS = new Set(['', '0.0.0.0', '::']);

type Env = Record<string, string | undefined>;

export interface TriggerDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  env: Env;
}

const defaultDeps: TriggerDeps = {
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: (level, message) => {
    const line = `[${level.toUpperCase()}] [Startup] ${message}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  },
  env: process.env,
};

/** `[fd00::5]` → `fd00::5` (IPv6 literals appear bracketed in URLs) */
function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

/** A specific (non-wildcard, non-loopback) IP literal, or null. */
function specificIp(host: string | undefined): string | null {
  const bare = stripBrackets(host?.trim() ?? '');
  return isIP(bare) !== 0 && !WILDCARD_HOSTS.has(bare) && !LOOPBACK_HOSTS.has(bare) ? bare : null;
}

/**
 * Hosts the startup secret may be sent to, in order: loopback (127.0.0.1, [::1]),
 * then the server's own bound address when it is an IP literal, taken from HOSTNAME
 * or from the origin Next records after binding (`next start -H <ip>`). The only
 * host name accepted is `localhost` in Next's own recorded origin; any other name
 * is never used, because it could resolve somewhere else.
 */
export function startupInitTargets(env: Env): string[] {
  const port = env.PORT?.trim() || '3000';
  const targets: string[] = [`http://127.0.0.1:${port}`, `http://[::1]:${port}`];

  const boundIp = specificIp(env.HOSTNAME);
  if (boundIp) targets.push(`http://${formatHost(boundIp)}:${port}`);

  const nextOrigin = env.__NEXT_PRIVATE_ORIGIN?.trim();
  if (nextOrigin) {
    try {
      const url = new URL(nextOrigin);
      const host = stripBrackets(url.hostname);
      if (url.protocol === 'http:' && (LOOPBACK_HOSTS.has(host) || specificIp(host))) targets.push(url.origin);
    } catch {
      // ignore malformed origin
    }
  }
  return [...new Set(targets)];
}

/** Delay before retry `attempt` (1-based): base · 2^(attempt-1), capped. */
export function startupRetryDelay(attempt: number): number {
  return Math.min(STARTUP_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), STARTUP_RETRY_MAX_MS);
}

function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as Error & { cause?: { code?: string } }).cause?.code;
  return code ? `${error.message} (${code})` : error.message;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/** Loop until the init route answers 200 on one of the allowed targets. Never rejects. */
export async function triggerStartupInit(overrides: Partial<TriggerDeps> = {}): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };
  const secret = getOrCreateStartupSecret();
  const targets = startupInitTargets(deps.env);
  let hinted = false;

  for (let attempt = 1; ; attempt++) {
    const failures: string[] = [];
    let anyAnswered = false;
    for (const target of targets) {
      try {
        const response = await deps.fetch(`${target}${STARTUP_INIT_PATH}`, {
          method: 'POST',
          headers: { [STARTUP_TOKEN_HEADER]: secret },
          signal: AbortSignal.timeout(STARTUP_ATTEMPT_TIMEOUT_MS),
          // The secret header must never follow a redirect
          redirect: 'error',
          cache: 'no-store',
        });
        if (response.status === 200) {
          deps.log('info', `Application services initialized via ${target} (attempt ${attempt})`);
          return;
        }
        anyAnswered = true;
        failures.push(`${target} -> HTTP ${response.status}`);
        // 503/500: this is our server, not ready or init failed — retry later.
        // Anything else (e.g. 404): not this process, try the next target.
        if (response.status === 503 || response.status === 500) break;
      } catch (error) {
        failures.push(`${target} -> ${describeFailure(error)}`);
        // A slow but healthy init is still running: don't start it again on another target
        if (isTimeout(error)) {
          anyAnswered = true;
          break;
        }
      }
    }

    if (!anyAnswered && !hinted) {
      hinted = true;
      deps.log(
        'warn',
        `Startup init could not reach this server on ${targets.join(', ')}. If the server listens on one ` +
          'specific address, set HOSTNAME to that IP address (not a host name), or bind to 0.0.0.0.'
      );
    }

    const delay = startupRetryDelay(attempt);
    const summary = `Startup init attempt ${attempt} failed (${failures.join('; ')}); retrying in ${Math.round(delay / 1000)}s`;
    if (delay < STARTUP_RETRY_MAX_MS) {
      deps.log(attempt === 1 ? 'info' : 'warn', summary);
    } else if (attempt % STARTUP_ERROR_LOG_EVERY === 0 || startupRetryDelay(attempt - 1) < STARTUP_RETRY_MAX_MS) {
      deps.log('error', `${summary}. Scheduled jobs are NOT running until this succeeds.`);
    } else {
      deps.log('warn', summary);
    }
    await deps.sleep(delay);
  }
}
