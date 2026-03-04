/**
 * Component: API Token Rate Limit Tests
 * Documentation: documentation/backend/services/auth.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkApiTokenCreateRateLimit,
  checkApiTokenRevokeRateLimit,
} from '@/lib/utils/apiTokenRateLimit';

describe('API Token Rate Limiting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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
});
