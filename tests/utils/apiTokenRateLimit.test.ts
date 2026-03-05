/**
 * Component: API Token Rate Limit Tests
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkApiTokenCreateRateLimit,
  checkApiTokenRevokeRateLimit,
  _resetBuckets,
  _getBucketCount,
} from '@/lib/utils/apiTokenRateLimit';
import { MAX_TOKENS_PER_USER } from '@/lib/constants/api-tokens';

describe('API Token Rate Limiting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetBuckets();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetBuckets();
  });

  describe('checkApiTokenCreateRateLimit', () => {
    it('allows requests under the limit', () => {
      const actorId = 'user-create-1';

      for (let i = 0; i < 10; i++) {
        const result = checkApiTokenCreateRateLimit(actorId);
        expect(result.allowed).toBe(true);
      }
    });

    it('blocks requests over the limit (10/min)', () => {
      const actorId = 'user-create-2';

      // Use up the limit
      for (let i = 0; i < 10; i++) {
        checkApiTokenCreateRateLimit(actorId);
      }

      // 11th request should be blocked
      const result = checkApiTokenCreateRateLimit(actorId);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('resets after the window expires', () => {
      const actorId = 'user-create-3';

      // Use up the limit
      for (let i = 0; i < 10; i++) {
        checkApiTokenCreateRateLimit(actorId);
      }

      // Should be blocked
      expect(checkApiTokenCreateRateLimit(actorId).allowed).toBe(false);

      // Advance time past the window (60 seconds)
      vi.advanceTimersByTime(61 * 1000);

      // Should be allowed again
      expect(checkApiTokenCreateRateLimit(actorId).allowed).toBe(true);
    });

    it('tracks different actors separately', () => {
      const actor1 = 'user-create-4';
      const actor2 = 'user-create-5';

      // Use up actor1's limit
      for (let i = 0; i < 10; i++) {
        checkApiTokenCreateRateLimit(actor1);
      }

      // actor1 should be blocked
      expect(checkApiTokenCreateRateLimit(actor1).allowed).toBe(false);

      // actor2 should still be allowed
      expect(checkApiTokenCreateRateLimit(actor2).allowed).toBe(true);
    });
  });

  describe('checkApiTokenRevokeRateLimit', () => {
    it('allows requests under the limit', () => {
      const actorId = 'user-revoke-1';

      for (let i = 0; i < 20; i++) {
        const result = checkApiTokenRevokeRateLimit(actorId);
        expect(result.allowed).toBe(true);
      }
    });

    it('blocks requests over the limit (20/min)', () => {
      const actorId = 'user-revoke-2';

      // Use up the limit
      for (let i = 0; i < 20; i++) {
        checkApiTokenRevokeRateLimit(actorId);
      }

      // 21st request should be blocked
      const result = checkApiTokenRevokeRateLimit(actorId);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('returns correct retryAfterSeconds', () => {
      const actorId = 'user-revoke-3';

      // Use up the limit
      for (let i = 0; i < 20; i++) {
        checkApiTokenRevokeRateLimit(actorId);
      }

      // Advance 30 seconds into the window
      vi.advanceTimersByTime(30 * 1000);

      const result = checkApiTokenRevokeRateLimit(actorId);
      expect(result.allowed).toBe(false);
      // Should have ~30 seconds left
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(30);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  describe('lazy eviction', () => {
    it('deletes expired buckets when they are next accessed', () => {
      const actorId = 'user-evict-1';

      // Create a bucket
      checkApiTokenCreateRateLimit(actorId);
      expect(_getBucketCount()).toBe(1);

      // Expire the window
      vi.advanceTimersByTime(61 * 1000);

      // Accessing the same key should evict the old bucket and create a fresh one
      checkApiTokenCreateRateLimit(actorId);
      // Should still be 1 (old one deleted, new one created)
      expect(_getBucketCount()).toBe(1);
    });

    it('does not delete buckets that are still active', () => {
      // Create buckets for two actors
      checkApiTokenCreateRateLimit('actor-a');
      checkApiTokenCreateRateLimit('actor-b');
      expect(_getBucketCount()).toBe(2);

      // Advance partially (not past the 60s window)
      vi.advanceTimersByTime(30 * 1000);

      // Both should still be there
      checkApiTokenCreateRateLimit('actor-a');
      expect(_getBucketCount()).toBe(2);
    });
  });

  describe('periodic sweep', () => {
    it('sweeps all expired buckets every 100 checks', () => {
      // Create 10 unique actor buckets
      for (let i = 0; i < 10; i++) {
        checkApiTokenCreateRateLimit(`sweep-actor-${i}`);
      }
      expect(_getBucketCount()).toBe(10);

      // Expire all windows
      vi.advanceTimersByTime(61 * 1000);

      // Add some fresh buckets that should NOT be swept
      checkApiTokenCreateRateLimit('sweep-fresh-1');
      checkApiTokenCreateRateLimit('sweep-fresh-2');

      // We've done 10 + 2 = 12 calls so far. Need 100 total to trigger sweep.
      // Do 88 more calls with unique actors to reach 100
      for (let i = 0; i < 88; i++) {
        checkApiTokenCreateRateLimit(`sweep-filler-${i}`);
      }

      // After the 100th call, the sweep should have removed the 10 expired buckets.
      // Remaining: 2 fresh + 88 filler = 90
      expect(_getBucketCount()).toBe(90);
    });
  });

  describe('_resetBuckets', () => {
    it('clears all buckets', () => {
      checkApiTokenCreateRateLimit('reset-1');
      checkApiTokenCreateRateLimit('reset-2');
      expect(_getBucketCount()).toBeGreaterThan(0);

      _resetBuckets();
      expect(_getBucketCount()).toBe(0);
    });
  });

  describe('MAX_TOKENS_PER_USER constant', () => {
    it('is set to 25', () => {
      expect(MAX_TOKENS_PER_USER).toBe(25);
    });
  });
});
