/**
 * Component: Relative Time Formatting Pins (date-fns formatDistanceToNow)
 * Documentation: documentation/admin-dashboard.md
 *
 * The admin tables show "x ago" via formatDistanceToNow(date, { addSuffix: true }).
 * These pins catch wording changes on a date-fns upgrade.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatDistanceToNow } from 'date-fns';

const NOW = new Date('2026-01-15T12:00:00Z');
const ago = (ms: number) => formatDistanceToNow(new Date(NOW.getTime() - ms), { addSuffix: true });

describe('formatDistanceToNow wording used in the admin UI', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [10 * 1000, 'less than a minute ago'],
    [60 * 1000, '1 minute ago'],
    [5 * 60 * 1000, '5 minutes ago'],
    [60 * 60 * 1000, 'about 1 hour ago'],
    [3 * 60 * 60 * 1000, 'about 3 hours ago'],
    [24 * 60 * 60 * 1000, '1 day ago'],
    [3 * 24 * 60 * 60 * 1000, '3 days ago'],
    [45 * 24 * 60 * 60 * 1000, 'about 2 months ago'],
    [400 * 24 * 60 * 60 * 1000, 'about 1 year ago'],
  ])('%i ms ago → %s', (ms, expected) => {
    expect(ago(ms)).toBe(expected);
  });

  it('formats future dates with "in"', () => {
    expect(formatDistanceToNow(new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000), { addSuffix: true })).toBe('in 2 days');
  });

  it('accepts an ISO string parsed with new Date(), as the components do', () => {
    expect(formatDistanceToNow(new Date('2026-01-15T11:55:00Z'), { addSuffix: true })).toBe('5 minutes ago');
  });
});
