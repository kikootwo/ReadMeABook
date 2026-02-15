/**
 * Component: Scrape Resilience Utilities
 * Documentation: documentation/integrations/audible.md
 *
 * Anti-503 resilience for Audible scraping: UA rotation, jittered backoff,
 * browser-like headers, adaptive pacing, and circuit breaker.
 */

/** Pool of modern browser User-Agent strings */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
] as const;

/** Randomly select a User-Agent (call once per session, not per request) */
export function pickUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** Build a full set of realistic browser headers for the given UA */
export function getBrowserHeaders(userAgent: string, acceptLanguage?: string): Record<string, string> {
  return {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': acceptLanguage || 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}

/**
 * Jittered exponential backoff: 2^attempt * baseMs * random(0.5, 1.5)
 * Avoids predictable retry timing that is trivially fingerprinted.
 */
export function jitteredBackoff(attempt: number, baseMs: number = 1000): number {
  const jitter = 0.5 + Math.random(); // 0.5 – 1.5
  return Math.round(Math.pow(2, attempt) * baseMs * jitter);
}

/** Random integer in [minMs, maxMs] */
export function randomDelay(minMs: number, maxMs: number): number {
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

/** Metadata returned alongside each fetch result */
export interface FetchResultMeta {
  retriesUsed: number;
  encountered503: boolean;
}

/**
 * Adaptive pacer that increases inter-page delays when retries are needed,
 * and triggers a circuit-breaker cooldown after consecutive retry-pages.
 */
export class AdaptivePacer {
  private consecutiveRetryPages = 0;
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 3;

  /** Report the result of a page fetch and get the recommended delay before the next page. */
  reportPageResult(meta: FetchResultMeta): number {
    if (meta.retriesUsed > 0) {
      this.consecutiveRetryPages++;

      // Circuit breaker: pause 45-60s after sustained retries
      if (this.consecutiveRetryPages >= AdaptivePacer.CIRCUIT_BREAKER_THRESHOLD) {
        this.consecutiveRetryPages = 0;
        return randomDelay(45_000, 60_000);
      }

      // Adaptive increase: multiply delay range by 1 + 0.5 * consecutive
      const multiplier = 1 + 0.5 * this.consecutiveRetryPages;
      return randomDelay(
        Math.round(2000 * multiplier),
        Math.round(4000 * multiplier),
      );
    }

    // Successful page – gradually recover
    if (this.consecutiveRetryPages > 0) {
      this.consecutiveRetryPages--;
    }

    // Base delay range
    return randomDelay(2000, 4000);
  }

  /** Reset state (call between batches or on re-initialization). */
  reset(): void {
    this.consecutiveRetryPages = 0;
  }
}
