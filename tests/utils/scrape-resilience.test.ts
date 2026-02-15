/**
 * Component: Scrape Resilience Utility Tests
 * Documentation: documentation/integrations/audible.md
 */

import { describe, expect, it } from 'vitest';
import {
  pickUserAgent,
  getBrowserHeaders,
  jitteredBackoff,
  randomDelay,
  AdaptivePacer,
} from '@/lib/utils/scrape-resilience';

describe('pickUserAgent', () => {
  it('returns a string containing Mozilla', () => {
    const ua = pickUserAgent();
    expect(typeof ua).toBe('string');
    expect(ua).toContain('Mozilla');
  });

  it('returns values from the known pool', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(pickUserAgent());
    }
    // Should have picked at least 2 different UAs over 100 draws
    expect(seen.size).toBeGreaterThanOrEqual(2);
    for (const ua of seen) {
      expect(ua).toContain('Mozilla/5.0');
    }
  });
});

describe('getBrowserHeaders', () => {
  it('includes all expected header keys', () => {
    const headers = getBrowserHeaders('TestUA/1.0');
    expect(headers['User-Agent']).toBe('TestUA/1.0');
    expect(headers['Accept']).toBeDefined();
    expect(headers['Accept-Language']).toBeDefined();
    expect(headers['Accept-Encoding']).toBeDefined();
    expect(headers['Connection']).toBeDefined();
    expect(headers['Sec-Fetch-Site']).toBeDefined();
    expect(headers['Sec-Fetch-Mode']).toBeDefined();
    expect(headers['Sec-Fetch-Dest']).toBeDefined();
    expect(headers['Sec-Fetch-User']).toBeDefined();
    expect(headers['Upgrade-Insecure-Requests']).toBeDefined();
  });

  it('defaults to en-US Accept-Language when no custom value given', () => {
    const headers = getBrowserHeaders('TestUA/1.0');
    expect(headers['Accept-Language']).toBe('en-US,en;q=0.9');
  });

  it('uses custom Accept-Language for non-English regions', () => {
    const headers = getBrowserHeaders('TestUA/1.0', 'de-DE,de;q=0.9,en;q=0.5');
    expect(headers['Accept-Language']).toBe('de-DE,de;q=0.9,en;q=0.5');
  });
});

describe('jitteredBackoff', () => {
  it('returns values within the expected jitter range', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      for (let i = 0; i < 50; i++) {
        const value = jitteredBackoff(attempt, 1000);
        const base = Math.pow(2, attempt) * 1000;
        // Jitter range is 0.5x – 1.5x
        expect(value).toBeGreaterThanOrEqual(Math.round(base * 0.5));
        expect(value).toBeLessThanOrEqual(Math.round(base * 1.5));
      }
    }
  });

  it('uses custom base ms', () => {
    const value = jitteredBackoff(0, 500);
    // attempt=0: 1 * 500 * [0.5..1.5] → [250..750]
    expect(value).toBeGreaterThanOrEqual(250);
    expect(value).toBeLessThanOrEqual(750);
  });
});

describe('randomDelay', () => {
  it('returns values within bounds', () => {
    for (let i = 0; i < 100; i++) {
      const val = randomDelay(100, 200);
      expect(val).toBeGreaterThanOrEqual(100);
      expect(val).toBeLessThanOrEqual(200);
    }
  });
});

describe('AdaptivePacer', () => {
  it('returns base delay range when no retries needed', () => {
    const pacer = new AdaptivePacer();
    for (let i = 0; i < 50; i++) {
      const delay = pacer.reportPageResult({ retriesUsed: 0, encountered503: false });
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThanOrEqual(4000);
    }
  });

  it('increases delay when retries occurred', () => {
    const pacer = new AdaptivePacer();
    // First retry page: consecutiveRetryPages becomes 1, multiplier = 1.5
    const delay = pacer.reportPageResult({ retriesUsed: 2, encountered503: true });
    // Range: [2000*1.5, 4000*1.5] = [3000, 6000]
    expect(delay).toBeGreaterThanOrEqual(3000);
    expect(delay).toBeLessThanOrEqual(6000);
  });

  it('triggers circuit breaker after 3 consecutive retry pages', () => {
    const pacer = new AdaptivePacer();
    const retryMeta = { retriesUsed: 1, encountered503: true };

    pacer.reportPageResult(retryMeta); // consecutive = 1
    pacer.reportPageResult(retryMeta); // consecutive = 2
    const cooldown = pacer.reportPageResult(retryMeta); // consecutive = 3 → circuit breaker

    expect(cooldown).toBeGreaterThanOrEqual(45000);
    expect(cooldown).toBeLessThanOrEqual(60000);
  });

  it('recovers gradually after successful pages', () => {
    const pacer = new AdaptivePacer();
    const retryMeta = { retriesUsed: 1, encountered503: true };
    const successMeta = { retriesUsed: 0, encountered503: false };

    // Build up to 2 consecutive retries
    pacer.reportPageResult(retryMeta); // consecutive = 1
    pacer.reportPageResult(retryMeta); // consecutive = 2

    // Success decrements: consecutive goes from 2 → 1
    const delay = pacer.reportPageResult(successMeta);
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThanOrEqual(4000);

    // Another success: consecutive goes from 1 → 0
    const delay2 = pacer.reportPageResult(successMeta);
    expect(delay2).toBeGreaterThanOrEqual(2000);
    expect(delay2).toBeLessThanOrEqual(4000);
  });

  it('resets state', () => {
    const pacer = new AdaptivePacer();
    const retryMeta = { retriesUsed: 1, encountered503: true };

    pacer.reportPageResult(retryMeta); // consecutive = 1
    pacer.reportPageResult(retryMeta); // consecutive = 2
    pacer.reset();

    // After reset, should be back to base range behavior for retries
    const delay = pacer.reportPageResult(retryMeta);
    // consecutive = 1 again, multiplier = 1.5 → [3000, 6000]
    expect(delay).toBeGreaterThanOrEqual(3000);
    expect(delay).toBeLessThanOrEqual(6000);
  });
});
