/**
 * Component: Release Date Utilities Tests
 * Documentation: documentation/backend/database.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isUnreleased, shouldSkipAutoSearch, toReleaseDay } from '@/lib/utils/release-date';

describe('isUnreleased', () => {
  it('returns false for null', () => {
    expect(isUnreleased(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isUnreleased(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isUnreleased('')).toBe(false);
  });

  it('returns false for malformed string', () => {
    expect(isUnreleased('not-a-date')).toBe(false);
  });

  it('returns false when release date is today (UTC date-only)', () => {
    const now = new Date();
    const today = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    ));
    expect(isUnreleased(today)).toBe(false);
  });

  it('returns false when release date is yesterday', () => {
    const now = new Date();
    const yesterday = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - 1
    ));
    expect(isUnreleased(yesterday)).toBe(false);
  });

  it('returns true when release date is tomorrow', () => {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1
    ));
    expect(isUnreleased(tomorrow)).toBe(true);
  });

  it('returns true for far-future ISO date string', () => {
    expect(isUnreleased('2099-01-01')).toBe(true);
  });

  it('returns true for far-future ISO datetime string', () => {
    expect(isUnreleased('2099-01-01T00:00:00Z')).toBe(true);
  });

  it('returns false for far-past Date object', () => {
    expect(isUnreleased(new Date('1990-01-01'))).toBe(false);
  });

  it('returns true for far-future Date object', () => {
    expect(isUnreleased(new Date('2099-01-01'))).toBe(true);
  });

  describe('UTC boundary cases with fake timers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('treats same UTC day as released regardless of clock time', () => {
      // Pin "now" to mid-day UTC on 2026-06-15
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));

      // A release date at the very start of the same UTC day → released
      expect(isUnreleased('2026-06-15T00:00:00Z')).toBe(false);
      // A release date at the very end of the same UTC day → released
      expect(isUnreleased('2026-06-15T23:59:59Z')).toBe(false);
    });

    it('treats next UTC day as unreleased', () => {
      vi.setSystemTime(new Date('2026-06-15T23:59:59Z'));
      expect(isUnreleased('2026-06-16T00:00:00Z')).toBe(true);
    });

    it('treats previous UTC day as released', () => {
      vi.setSystemTime(new Date('2026-06-15T00:00:00Z'));
      expect(isUnreleased('2026-06-14T23:59:59Z')).toBe(false);
    });
  });
});

describe('shouldSkipAutoSearch', () => {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  it('does not skip when setting is OFF, even if unreleased', () => {
    expect(shouldSkipAutoSearch({ releaseDate: tomorrow }, false)).toEqual({
      skip: false,
    });
  });

  it('skips with reason "unreleased" when setting ON and release is in the future', () => {
    expect(shouldSkipAutoSearch({ releaseDate: tomorrow }, true)).toEqual({
      skip: true,
      reason: 'unreleased',
    });
  });

  it('does not skip when setting ON and release is in the past', () => {
    expect(shouldSkipAutoSearch({ releaseDate: yesterday }, true)).toEqual({
      skip: false,
    });
  });

  it('does not skip when setting ON and releaseDate is null', () => {
    expect(shouldSkipAutoSearch({ releaseDate: null }, true)).toEqual({
      skip: false,
    });
  });
});

describe('toReleaseDay', () => {
  it('keeps an ISO date (catalog API, modern series rows)', () => {
    expect(toReleaseDay('2021-01-28')).toBe('2021-01-28');
    expect(toReleaseDay(' 2021-01-28 ')).toBe('2021-01-28');
  });

  it('takes the date part of an ISO datetime (Audnexus)', () => {
    expect(toReleaseDay('2021-01-28T00:00:00.000Z')).toBe('2021-01-28');
  });

  it('uses the UTC day of a Date', () => {
    expect(toReleaseDay(new Date('2026-10-27T01:00:00Z'))).toBe('2026-10-27');
    expect(toReleaseDay(new Date('nope'))).toBeNull();
  });

  it('returns null for a legacy series label date, whose day/month order varies', () => {
    expect(toReleaseDay('01-28-21')).toBeNull();
    expect(toReleaseDay('28.01.2021')).toBeNull();
  });

  it('returns null for impossible dates', () => {
    expect(toReleaseDay('2021-13-01')).toBeNull();
    expect(toReleaseDay('2021-02-30')).toBeNull();
  });

  it('returns null when there is no date', () => {
    expect(toReleaseDay('')).toBeNull();
    expect(toReleaseDay(undefined)).toBeNull();
    expect(toReleaseDay(null)).toBeNull();
  });
});
