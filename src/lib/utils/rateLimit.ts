/**
 * Component: Rate Limiting
 * Documentation: documentation/backend/services/auth.md
 *
 * In-memory fixed-window rate limiter, split into namespaces. Each namespace has its
 * own limit, window and entry cap. The store lives on globalThis (processSingleton), so
 * every copy of this module in the process shares one set of counters.
 *
 * - reserve() checks every requested bucket first (the same bucket twice needs two
 *   slots), then counts all of them or none; room is made only once every check passed.
 * - refund() gives back one reservation, only within the window it was made in.
 * - A full namespace drops an expired entry or one under half its limit; an entry at
 *   or past half its limit is never dropped. With nothing to drop, the new key is refused.
 * - The counts of the last maxEntries dropped entries are kept; a dropped key that comes
 *   back within its window resumes its count.
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

type DroppedCount = { count: number; resetAt: number };

type NamespaceState = {
  buckets: Map<string, Bucket>;
  /** Counts of dropped entries, oldest drop first, at most maxEntries */
  dropped: Map<string, DroppedCount>;
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
    state = { buckets: new Map(), dropped: new Map(), calls: 0, lastExpiredSweepAt: 0, noScanUntil: 0, fullLoggedAt: 0 };
    namespaces.set(namespace, state);
  }
  return state;
}

function sweepExpired(state: NamespaceState, now: number): void {
  for (const [key, bucket] of state.buckets) {
    if (now >= bucket.resetAt) state.buckets.delete(key);
  }
  for (const [key, dropped] of state.dropped) {
    if (now >= dropped.resetAt) state.dropped.delete(key);
  }
}

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

/**
 * Keys to drop so `needed` new keys fit, or null when the namespace is full of live
 * counters. Never picks a key in `keep`. Drops nothing itself (only expired entries go).
 */
function findRoom(
  namespace: RateLimitNamespace,
  state: NamespaceState,
  now: number,
  needed: number,
  keep: ReadonlySet<string>
): string[] | null {
  const { limit, maxEntries } = RATE_LIMITS[namespace];
  if (state.buckets.size + needed <= maxEntries) return [];
  if (now < state.noScanUntil) return null;

  if (now - state.lastExpiredSweepAt >= SCAN_PAUSE_MS) {
    state.lastExpiredSweepAt = now;
    sweepExpired(state, now);
    if (state.buckets.size + needed <= maxEntries) return [];
  }

  store().roomScans += 1;
  const excess = state.buckets.size + needed - maxEntries;
  const victims: string[] = [];
  for (const [key, bucket] of state.buckets) {
    if (keep.has(key) || (now < bucket.resetAt && bucket.count * 2 >= limit)) continue;
    victims.push(key);
    if (victims.length === excess) return victims;
  }

  state.noScanUntil = now + SCAN_PAUSE_MS;
  if (now - state.fullLoggedAt >= FULL_LOG_INTERVAL_MS) {
    state.fullLoggedAt = now;
    logger.warn('Rate-limit store full; new keys refused', { namespace });
  }
  return null;
}

/** Drop one entry, keeping its live count so the key resumes it if it comes back */
function dropEntry(namespace: RateLimitNamespace, state: NamespaceState, key: string, now: number): void {
  const bucket = state.buckets.get(key);
  state.buckets.delete(key);
  if (!bucket || now >= bucket.resetAt || bucket.count === 0) return;
  state.dropped.delete(key);
  state.dropped.set(key, { count: bucket.count, resetAt: bucket.resetAt });
  if (state.dropped.size > RATE_LIMITS[namespace].maxEntries) {
    const oldest = state.dropped.keys().next();
    if (!oldest.done) state.dropped.delete(oldest.value);
  }
}

/** The kept count of a dropped key, while its window lasts */
function droppedCount(state: NamespaceState, key: string, now: number): DroppedCount | undefined {
  const dropped = state.dropped.get(key);
  if (dropped && now >= dropped.resetAt) {
    state.dropped.delete(key);
    return undefined;
  }
  return dropped;
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

  // One plan per bucket: the same bucket asked for twice needs two slots
  type Plan = { namespace: RateLimitNamespace; key: string; uses: number; live?: Bucket; resumed?: DroppedCount };
  const plans = new Map<string, Plan>();
  for (const { namespace, key } of requests) {
    const id = `${namespace}\u0000${key}`;
    const plan = plans.get(id);
    if (plan) plan.uses += 1;
    else plans.set(id, { namespace, key, uses: 1 });
  }

  for (const plan of plans.values()) {
    const state = stateFor(plan.namespace);
    state.calls += 1;
    if (state.calls >= SWEEP_INTERVAL) {
      state.calls = 0;
      sweepExpired(state, now);
    }
    const bucket = state.buckets.get(plan.key);
    if (bucket && now >= bucket.resetAt) state.buckets.delete(plan.key);
    plan.live = bucket && now < bucket.resetAt ? bucket : undefined;
    if (!plan.live) plan.resumed = droppedCount(state, plan.key, now);
  }

  // Check every bucket, in the given order, before changing anything
  const roomChecked = new Set<RateLimitNamespace>();
  const victims: Array<{ namespace: RateLimitNamespace; keys: string[] }> = [];
  for (const plan of plans.values()) {
    const { namespace, key, uses, live, resumed } = plan;
    const current = live ?? resumed;
    if (current && current.count + uses > RATE_LIMITS[namespace].limit) {
      const firstRefusal = live ? !live.refusalLogged : false;
      if (live) live.refusalLogged = true;
      return {
        ok: false,
        refusal: { namespace, key, retryAfterSeconds: secondsUntil(current.resetAt, now), reason: 'limit', firstRefusal },
      };
    }
    if (live || roomChecked.has(namespace)) continue;

    roomChecked.add(namespace);
    const inNamespace = [...plans.values()].filter((other) => other.namespace === namespace);
    const keep = new Set(inNamespace.filter((other) => other.live).map((other) => other.key));
    const needed = inNamespace.length - keep.size;
    const state = stateFor(namespace);
    const keys = findRoom(namespace, state, now, needed, keep);
    if (!keys) {
      return {
        ok: false,
        refusal: { namespace, key, retryAfterSeconds: fullRetryAfter(state, now), reason: 'full', firstRefusal: false },
      };
    }
    victims.push({ namespace, keys });
  }

  for (const { namespace, keys } of victims) {
    const state = stateFor(namespace);
    for (const key of keys) dropEntry(namespace, state, key, now);
  }
  for (const plan of plans.values()) {
    if (plan.live) {
      plan.live.count += plan.uses;
      continue;
    }
    const state = stateFor(plan.namespace);
    state.dropped.delete(plan.key);
    plan.live = {
      count: (plan.resumed?.count ?? 0) + plan.uses,
      resetAt: plan.resumed?.resetAt ?? now + RATE_LIMITS[plan.namespace].windowMs,
      refusalLogged: false,
    };
    state.buckets.set(plan.key, plan.live);
  }

  const reservations = requests.map(({ namespace, key }) => ({
    namespace,
    key,
    resetAt: plans.get(`${namespace}\u0000${key}`)!.live!.resetAt,
  }));
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
