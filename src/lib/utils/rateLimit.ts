/**
 * Component: Rate Limiting
 * Documentation: documentation/backend/services/auth.md
 *
 * In-memory fixed-window rate limiter, split into namespaces. Each namespace has its
 * own limit, window and entry cap. The store lives on globalThis (processSingleton), so
 * every copy of this module in the process shares one set of counters.
 *
 * - reserve() checks every requested bucket first, then counts all of them or none.
 * - refund() gives back one reservation, only within the window it was made in.
 * - A full namespace drops an expired entry or one under half its limit; an entry at
 *   or past half its limit is never dropped. With nothing to drop, the new key is refused.
 */

import { processSingleton } from './process-singleton';
import { RMABLogger } from './logger';

const logger = RMABLogger.create('RateLimit');

const MINUTE_MS = 60 * 1000;

export const RATE_LIMITS = {
  'signin-account': { limit: 10, windowMs: 15 * MINUTE_MS, maxEntries: 10_000 },
  'signin-address': { limit: 20, windowMs: 15 * MINUTE_MS, maxEntries: 10_000 },
  'signin-known-browser': { limit: 10, windowMs: 15 * MINUTE_MS, maxEntries: 2_000 },
  'register-address': { limit: 5, windowMs: 60 * MINUTE_MS, maxEntries: 10_000 },
  'token-login': { limit: 10, windowMs: 15 * MINUTE_MS, maxEntries: 10_000 },
  'api-token-create': { limit: 10, windowMs: MINUTE_MS, maxEntries: 10_000 },
  'api-token-revoke': { limit: 20, windowMs: MINUTE_MS, maxEntries: 10_000 },
  'password-change': { limit: 10, windowMs: 15 * MINUTE_MS, maxEntries: 10_000 },
} as const;

export type RateLimitNamespace = keyof typeof RATE_LIMITS;

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type Reservation = { namespace: RateLimitNamespace; key: string; resetAt: number };

export type RateLimitRefusal = {
  namespace: RateLimitNamespace;
  key: string;
  retryAfterSeconds: number;
  /** 'limit': the bucket is at its limit; 'full': the namespace has no room for a new key */
  reason: 'limit' | 'full';
  /** True only for the first 'limit' refusal of this bucket in its window (log once) */
  firstRefusal: boolean;
};

export type ReserveResult =
  | { ok: true; reservations: Reservation[] }
  | { ok: false; refusal: RateLimitRefusal };

type Bucket = { count: number; resetAt: number; refusalLogged: boolean };

type NamespaceState = {
  buckets: Map<string, Bucket>;
  calls: number;
  lastExpiredSweepAt: number;
  noScanUntil: number;
  fullLoggedAt: number;
};

/** How often (in calls per namespace) to sweep that namespace's expired buckets */
const SWEEP_INTERVAL = 100;
/** Least time between expired sweeps and between failed room scans, per namespace */
const SCAN_PAUSE_MS = 1000;
const FULL_LOG_INTERVAL_MS = MINUTE_MS;

const store = () =>
  processSingleton('rate-limit-store', () => ({
    namespaces: new Map<RateLimitNamespace, NamespaceState>(),
    roomScans: 0,
  }));

function stateFor(namespace: RateLimitNamespace): NamespaceState {
  const { namespaces } = store();
  let state = namespaces.get(namespace);
  if (!state) {
    state = { buckets: new Map(), calls: 0, lastExpiredSweepAt: 0, noScanUntil: 0, fullLoggedAt: 0 };
    namespaces.set(namespace, state);
  }
  return state;
}

function sweepExpired(state: NamespaceState, now: number): void {
  for (const [key, bucket] of state.buckets) {
    if (now >= bucket.resetAt) state.buckets.delete(key);
  }
}

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

/** Make room for one new key. Returns false when the namespace is full of live counters. */
function makeRoom(namespace: RateLimitNamespace, state: NamespaceState, now: number): boolean {
  const { limit, maxEntries } = RATE_LIMITS[namespace];
  if (state.buckets.size < maxEntries) return true;
  if (now < state.noScanUntil) return false;

  if (now - state.lastExpiredSweepAt >= SCAN_PAUSE_MS) {
    state.lastExpiredSweepAt = now;
    sweepExpired(state, now);
    if (state.buckets.size < maxEntries) return true;
  }

  store().roomScans += 1;
  for (const [key, bucket] of state.buckets) {
    if (now >= bucket.resetAt || bucket.count * 2 < limit) {
      state.buckets.delete(key);
      return true;
    }
  }

  state.noScanUntil = now + SCAN_PAUSE_MS;
  if (now - state.fullLoggedAt >= FULL_LOG_INTERVAL_MS) {
    state.fullLoggedAt = now;
    logger.warn('Rate-limit store full; new keys refused', { namespace });
  }
  return false;
}

/** Retry time for a refused new key: until the oldest entry in the namespace expires. */
function fullRetryAfter(state: NamespaceState, now: number): number {
  const oldest = state.buckets.values().next();
  return oldest.done ? 1 : secondsUntil(oldest.value.resetAt, now);
}

/**
 * Reserve one slot in each requested bucket, all or none. Synchronous by design: call it
 * before any await that the reservation guards. On refusal, the first refused bucket in
 * the given order is returned and nothing is counted.
 */
export function reserve(requests: ReadonlyArray<{ namespace: RateLimitNamespace; key: string }>): ReserveResult {
  const now = Date.now();
  const missing: boolean[] = [];

  for (const { namespace, key } of requests) {
    const state = stateFor(namespace);
    state.calls += 1;
    if (state.calls >= SWEEP_INTERVAL) {
      state.calls = 0;
      sweepExpired(state, now);
    }

    const bucket = state.buckets.get(key);
    if (bucket && now >= bucket.resetAt) state.buckets.delete(key);
    const live = bucket && now < bucket.resetAt ? bucket : undefined;

    if (live && live.count >= RATE_LIMITS[namespace].limit) {
      const firstRefusal = !live.refusalLogged;
      live.refusalLogged = true;
      return {
        ok: false,
        refusal: { namespace, key, retryAfterSeconds: secondsUntil(live.resetAt, now), reason: 'limit', firstRefusal },
      };
    }
    if (!live && !makeRoom(namespace, state, now)) {
      return {
        ok: false,
        refusal: { namespace, key, retryAfterSeconds: fullRetryAfter(state, now), reason: 'full', firstRefusal: false },
      };
    }
    missing.push(!live);
  }

  const reservations = requests.map(({ namespace, key }, index) => {
    const state = stateFor(namespace);
    let bucket = state.buckets.get(key);
    if (missing[index] || !bucket) {
      bucket = { count: 0, resetAt: now + RATE_LIMITS[namespace].windowMs, refusalLogged: false };
      state.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return { namespace, key, resetAt: bucket.resetAt };
  });
  return { ok: true, reservations };
}

/** Give back reservations. Only touches a bucket still in the window it was reserved in. */
export function refund(reservations: ReadonlyArray<Reservation>): void {
  for (const { namespace, key, resetAt } of reservations) {
    const bucket = stateFor(namespace).buckets.get(key);
    if (bucket && bucket.resetAt === resetAt && bucket.count > 0) bucket.count -= 1;
  }
}

/** "1 minute" / "N minutes" for a Retry-After value in seconds (at least 1 minute) */
export function formatRetryAfter(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function consume(namespace: RateLimitNamespace, key: string): RateLimitResult {
  const result = reserve([{ namespace, key }]);
  if (!result.ok) return { allowed: false, retryAfterSeconds: result.refusal.retryAfterSeconds };
  return { allowed: true, retryAfterSeconds: secondsUntil(result.reservations[0].resetAt, Date.now()) };
}

/** 10 attempts per minute per actor */
export function checkApiTokenCreateRateLimit(actorId: string): RateLimitResult {
  return consume('api-token-create', actorId);
}

/** 20 attempts per minute per actor */
export function checkApiTokenRevokeRateLimit(actorId: string): RateLimitResult {
  return consume('api-token-revoke', actorId);
}

/** 10 attempts per 15 minutes per client address key */
export function checkTokenLoginRateLimit(addressKey: string): RateLimitResult {
  return consume('token-login', addressKey);
}

/** 5 attempts per hour per client address key */
export function checkRegisterRateLimit(addressKey: string): RateLimitResult {
  return consume('register-address', addressKey);
}

/** Reset every namespace. For testing only. */
export function _resetBuckets(): void {
  const current = store();
  current.namespaces.clear();
  current.roomScans = 0;
}

/** Number of tracked buckets, in one namespace or in all. For testing only. */
export function _getBucketCount(namespace?: RateLimitNamespace): number {
  const { namespaces } = store();
  if (namespace) return namespaces.get(namespace)?.buckets.size ?? 0;
  let total = 0;
  for (const state of namespaces.values()) total += state.buckets.size;
  return total;
}

/** Current count of one bucket (0 when absent or expired). For testing only. */
export function _getBucketUsage(namespace: RateLimitNamespace, key: string): number {
  const bucket = store().namespaces.get(namespace)?.buckets.get(key);
  return bucket && Date.now() < bucket.resetAt ? bucket.count : 0;
}

/** Number of scans for an evictable entry since the last reset. For testing only. */
export function _getRoomScanCount(): number {
  return store().roomScans;
}
