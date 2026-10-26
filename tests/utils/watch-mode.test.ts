/**
 * Component: Watch Mode Helpers Tests
 * Documentation: documentation/features/watched-lists.md
 */

import { describe, expect, it } from 'vitest';
import { isNewRelease, newReleaseFloorDay, nextNewReleasesSince, watchModeFields } from '@/lib/utils/watch-mode';

const NOW = new Date('2026-10-26T20:15:00Z');

describe('nextNewReleasesSince', () => {
  it('starts a cutoff now when new-only is turned on', () => {
    expect(nextNewReleasesSince(null, true, NOW)).toBe(NOW);
    expect(nextNewReleasesSince(undefined, true, NOW)).toBe(NOW);
  });

  it('keeps an existing cutoff when new-only is asked for again', () => {
    const earlier = new Date('2026-01-02T03:04:05Z');
    expect(nextNewReleasesSince(earlier, true, NOW)).toBe(earlier);
  });

  it('clears the cutoff for entire catalog', () => {
    expect(nextNewReleasesSince(new Date('2026-01-02T00:00:00Z'), false, NOW)).toBeNull();
    expect(nextNewReleasesSince(null, false, NOW)).toBeNull();
  });
});

describe('watchModeFields', () => {
  it('reads a null or missing cutoff as entire catalog', () => {
    expect(watchModeFields({ newReleasesSince: null })).toEqual({ newReleasesOnly: false, newReleasesSince: null });
    expect(watchModeFields({})).toEqual({ newReleasesOnly: false, newReleasesSince: null });
  });

  it('reads a cutoff as new releases only', () => {
    expect(watchModeFields({ newReleasesSince: NOW })).toEqual({ newReleasesOnly: true, newReleasesSince: NOW });
  });
});

describe('isNewRelease (cutoff UTC day minus one day of grace)', () => {
  it('requests the day before a cutoff that is already tomorrow in UTC, not two days before', () => {
    const cutoff = new Date('2026-10-27T01:00:00Z'); // 9 PM EDT on Oct 26
    expect(newReleaseFloorDay(cutoff)).toBe('2026-10-26');
    expect(isNewRelease('2026-10-26', cutoff)).toBe(true);
    expect(isNewRelease('2026-10-25', cutoff)).toBe(false);
  });

  it('requests a book dated the cutoff day when the cutoff is mid-day', () => {
    const cutoff = new Date('2026-10-26T18:00:00Z');
    expect(isNewRelease('2026-10-26', cutoff)).toBe(true);
    expect(isNewRelease('2026-10-26T00:00:00.000Z', cutoff)).toBe(true);
  });

  it('requests later and future-dated books, skips older ones', () => {
    const cutoff = new Date('2026-10-26T18:00:00Z');
    expect(isNewRelease('2026-11-03', cutoff)).toBe(true);
    expect(isNewRelease('2027-05-01', cutoff)).toBe(true);
    expect(isNewRelease('2021-01-28', cutoff)).toBe(false);
  });

  it('never counts an undated or unreadable date as new', () => {
    const cutoff = new Date('2026-10-26T18:00:00Z');
    expect(isNewRelease(undefined, cutoff)).toBe(false);
    expect(isNewRelease('', cutoff)).toBe(false);
    expect(isNewRelease('10-27-26', cutoff)).toBe(false);
  });

  it('crosses month and year boundaries', () => {
    expect(newReleaseFloorDay(new Date('2027-01-01T05:00:00Z'))).toBe('2026-12-31');
    expect(newReleaseFloorDay(new Date('2028-03-01T00:00:00Z'))).toBe('2028-02-29');
  });
});
