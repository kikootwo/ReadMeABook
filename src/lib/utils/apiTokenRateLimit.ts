/**
 * Component: API Token Rate Limiting
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * In-memory sliding-window rate limiter with lazy eviction and periodic sweep
 * to prevent unbounded memory growth.
 */

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const buckets = new Map<string, Bucket>();

/** Number of checkRateLimit calls since the last full sweep */
let checkCount = 0;

/** How often (in calls) to perform a full sweep of expired buckets */
const SWEEP_INTERVAL = 100;

/**
 * Sweep the entire bucket map and delete all expired entries.
 * Called automatically every SWEEP_INTERVAL checks.
 */
function sweepExpiredBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(key);
    }
  }
}

function checkRateLimit(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  // Periodic full sweep every SWEEP_INTERVAL calls
  checkCount += 1;
  if (checkCount >= SWEEP_INTERVAL) {
    checkCount = 0;
    sweepExpiredBuckets();
  }

  const current = buckets.get(key);

  // Lazy eviction: if the bucket is expired, delete it and start fresh
  if (!current || now >= current.resetAt) {
    if (current) {
      buckets.delete(key);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  if (current.count >= maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return {
    allowed: true,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}

export function checkApiTokenCreateRateLimit(actorId: string): RateLimitResult {
  return checkRateLimit(`api-token-create:${actorId}`, 10, 60 * 1000);
}

export function checkApiTokenRevokeRateLimit(actorId: string): RateLimitResult {
  return checkRateLimit(`api-token-revoke:${actorId}`, 20, 60 * 1000);
}

/** Reset all buckets and the sweep counter. For testing only. */
export function _resetBuckets(): void {
  buckets.clear();
  checkCount = 0;
}

/** Get the current number of tracked buckets. For testing only. */
export function _getBucketCount(): number {
  return buckets.size;
}
