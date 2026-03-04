type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const buckets = new Map<string, Bucket>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || now >= current.resetAt) {
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
