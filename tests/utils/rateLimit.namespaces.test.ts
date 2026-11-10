/**
 * Component: Rate Limiter Namespace Tests
 * Documentation: documentation/backend/services/auth.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RATE_LIMITS,
  reserve,
  refund,
  formatRetryAfter,
  checkRegisterRateLimit,
  checkTokenLoginRateLimit,
  _resetBuckets,
  _getBucketCount,
  _getBucketUsage,
  _getRoomScanCount,
  type RateLimitNamespace,
} from '@/lib/utils/rateLimit';

const one = (namespace: RateLimitNamespace, key: string) => reserve([{ namespace, key }]);

describe('rate limiter namespaces', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetBuckets();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetBuckets();
  });

  it('has the agreed numbers for every namespace', () => {
    expect(RATE_LIMITS).toEqual({
      'signin-account': { limit: 10, windowMs: 900_000, maxEntries: 10_000 },
      'signin-address': { limit: 20, windowMs: 900_000, maxEntries: 10_000 },
      'signin-known-browser': { limit: 10, windowMs: 900_000, maxEntries: 2_000 },
      'register-address': { limit: 5, windowMs: 3_600_000, maxEntries: 10_000 },
      'token-login': { limit: 10, windowMs: 900_000, maxEntries: 10_000 },
      'api-token-create': { limit: 10, windowMs: 60_000, maxEntries: 10_000 },
      'api-token-revoke': { limit: 20, windowMs: 60_000, maxEntries: 10_000 },
      'password-change': { limit: 10, windowMs: 900_000, maxEntries: 10_000 },
    });
  });

  it.each(Object.entries(RATE_LIMITS) as Array<[RateLimitNamespace, { limit: number; windowMs: number }]>)(
    '%s refuses the reservation after its limit and allows it again after its window',
    (namespace, { limit, windowMs }) => {
      for (let i = 0; i < limit; i += 1) expect(one(namespace, 'k').ok).toBe(true);
      const refused = one(namespace, 'k');
      expect(refused).toMatchObject({ ok: false, refusal: { namespace, key: 'k', reason: 'limit' } });
      vi.advanceTimersByTime(windowMs);
      expect(one(namespace, 'k').ok).toBe(true);
    }
  );

  it('keeps namespaces apart', () => {
    for (let i = 0; i < 10; i += 1) one('signin-account', 'same');
    expect(one('signin-account', 'same').ok).toBe(false);
    expect(one('password-change', 'same').ok).toBe(true);
  });

  it('reserves several buckets all or nothing: a full address leaves the account count unchanged', () => {
    for (let i = 0; i < 20; i += 1) one('signin-address', 'addr');
    one('signin-account', 'acct');
    const result = reserve([
      { namespace: 'signin-account', key: 'acct' },
      { namespace: 'signin-address', key: 'addr' },
    ]);
    expect(result).toMatchObject({ ok: false, refusal: { namespace: 'signin-address' } });
    expect(_getBucketUsage('signin-account', 'acct')).toBe(1);
  });

  it('returns the first refusal in the given order', () => {
    for (let i = 0; i < 10; i += 1) one('signin-account', 'acct');
    for (let i = 0; i < 20; i += 1) one('signin-address', 'addr');
    const result = reserve([
      { namespace: 'signin-account', key: 'acct' },
      { namespace: 'signin-address', key: 'addr' },
    ]);
    expect(result).toMatchObject({ ok: false, refusal: { namespace: 'signin-account' } });
  });

  it('marks only the first refusal of a bucket in its window', () => {
    for (let i = 0; i < 10; i += 1) one('signin-account', 'acct');
    const flags = Array.from({ length: 5 }, () => {
      const result = one('signin-account', 'acct');
      return result.ok ? null : result.refusal.firstRefusal;
    });
    expect(flags).toEqual([true, false, false, false, false]);
    vi.advanceTimersByTime(900_000);
    for (let i = 0; i < 10; i += 1) one('signin-account', 'acct');
    const next = one('signin-account', 'acct');
    expect(next.ok ? null : next.refusal.firstRefusal).toBe(true);
  });

  it('refunds within the window only, and never below zero', () => {
    const first = one('signin-account', 'acct');
    if (!first.ok) throw new Error('expected a reservation');
    refund(first.reservations);
    refund(first.reservations);
    expect(_getBucketUsage('signin-account', 'acct')).toBe(0);

    const old = one('signin-account', 'acct');
    if (!old.ok) throw new Error('expected a reservation');
    vi.advanceTimersByTime(900_000);
    one('signin-account', 'acct');
    one('signin-account', 'acct');
    refund(old.reservations);
    expect(_getBucketUsage('signin-account', 'acct')).toBe(2);
  });

  it('keeps a capped entry while many new keys arrive', () => {
    const { maxEntries } = RATE_LIMITS['signin-account'];
    for (let i = 0; i < 10; i += 1) one('signin-account', 'capped');
    for (let i = 0; i < 4; i += 1) one('signin-account', 'half'); // 4 of 10: under half
    for (let i = 0; i < 5; i += 1) one('signin-account', 'at-half');

    for (let i = 0; i < maxEntries * 2; i += 1) {
      expect(one('signin-account', `new-${i}`).ok).toBe(true);
    }

    expect(_getBucketCount('signin-account')).toBe(maxEntries);
    expect(one('signin-account', 'capped')).toMatchObject({ ok: false, refusal: { reason: 'limit' } });
    expect(_getBucketUsage('signin-account', 'at-half')).toBe(5);
    expect(_getBucketUsage('signin-account', 'half')).toBe(0);
  });

  it('refuses a new key when every entry is at or past half its limit, and pauses scans for a second', () => {
    const { maxEntries } = RATE_LIMITS['signin-known-browser'];
    for (let i = 0; i < maxEntries; i += 1) {
      for (let n = 0; n < 5; n += 1) one('signin-known-browser', `live-${i}`);
    }
    const scansBefore = _getRoomScanCount();

    const refused = one('signin-known-browser', 'new-1');
    expect(refused).toMatchObject({ ok: false, refusal: { reason: 'full', firstRefusal: false } });
    expect(refused.ok ? 0 : refused.refusal.retryAfterSeconds).toBeGreaterThan(0);
    expect(_getRoomScanCount()).toBe(scansBefore + 1);

    vi.advanceTimersByTime(500);
    expect(one('signin-known-browser', 'new-2').ok).toBe(false);
    expect(_getRoomScanCount()).toBe(scansBefore + 1);

    // Existing keys keep working while the namespace is full
    expect(one('signin-known-browser', 'live-0').ok).toBe(true);

    vi.advanceTimersByTime(600);
    expect(one('signin-known-browser', 'new-3').ok).toBe(false);
    expect(_getRoomScanCount()).toBe(scansBefore + 2);

    vi.advanceTimersByTime(900_000);
    expect(one('signin-known-browser', 'new-4').ok).toBe(true);
  });

  it('shares counts between two copies of the module', async () => {
    for (let i = 0; i < 10; i += 1) one('password-change', 'user-1');
    vi.resetModules();
    const second = await import('@/lib/utils/rateLimit');
    expect(second.reserve([{ namespace: 'password-change', key: 'user-1' }]).ok).toBe(false);
    expect(second._getBucketUsage('password-change', 'user-1')).toBe(10);
  });

  it('keeps the register and token-login wrappers on their own numbers', () => {
    for (let i = 0; i < 5; i += 1) expect(checkRegisterRateLimit('4:203.0.113.7').allowed).toBe(true);
    expect(checkRegisterRateLimit('4:203.0.113.7').allowed).toBe(false);
    for (let i = 0; i < 10; i += 1) expect(checkTokenLoginRateLimit('4:203.0.113.7').allowed).toBe(true);
    expect(checkTokenLoginRateLimit('4:203.0.113.7')).toMatchObject({ allowed: false });
  });

  it.each([
    [59, '1 minute'],
    [60, '1 minute'],
    [61, '2 minutes'],
    [900, '15 minutes'],
    [0, '1 minute'],
  ])('formats %d seconds as %s', (seconds, text) => {
    expect(formatRetryAfter(seconds)).toBe(text);
  });
});
