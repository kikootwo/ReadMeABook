/**
 * Component: Library card display rules
 * Documentation: documentation/features/library-view.md
 */

import { describe, expect, it } from 'vitest';
import {
  cardAriaLabel,
  cardLabel,
  cardMeta,
  cardPill,
  coverTone,
  formatDuration,
  releaseLabel,
  requesterLabel,
  showsProgress,
  sizeLabel,
} from '@/components/library/card-display';
import { item, scanItem } from './fixtures';

describe('card display', () => {
  it.each([
    ['available', 'emerald'],
    ['downloading', 'amber'],
    ['processing', 'amber'],
    ['downloaded', 'amber'],
    ['awaiting_import', 'amber'],
    ['pending', 'blue'],
    ['awaiting_search', 'blue'],
    ['searching', 'blue'],
    ['awaiting_approval', 'blue'],
    ['awaiting_release', 'blue'],
    ['failed', 'red'],
    ['warn', 'red'],
    ['denied', 'red'],
  ])('%s is %s', (status, tone) => {
    expect(coverTone(item({ status }))).toBe(tone);
  });

  it('a library book is emerald whatever its status, with duration (else year) and no pill', () => {
    const lib = scanItem({ durationMinutes: 724 });
    expect(coverTone(lib)).toBe('emerald');
    expect(cardPill(lib)).toBeNull();
    expect(cardMeta(lib)).toBe('12h 4m');
    expect(cardMeta(scanItem({ durationMinutes: null, year: 1989 }))).toBe('1989');
    expect(cardLabel(lib)).toBe('In your library');
  });

  it('labels come from StatusBadge', () => {
    expect(cardLabel(item({ status: 'awaiting_approval' }))).toBe('Pending Approval');
    expect(cardLabel(item({ status: 'awaiting_release' }))).toBe('Awaiting Release');
    expect(cardLabel(item({ status: 'denied' }))).toBe('Request Denied');
  });

  it('downloading shows the percentage in the pill and the meta line, and the bar', () => {
    const dl = item({ status: 'downloading', statusGroup: 'on_the_way', progress: 41.6 });
    expect(cardPill(dl)).toBe('Downloading 42%');
    expect(cardMeta(dl)).toBe('Downloading · 42%');
    expect(showsProgress(dl)).toBe(true);
    expect(showsProgress(item({ status: 'processing' }))).toBe(false);
  });

  it('awaiting release shows the release date when known', () => {
    const now = new Date('2026-11-09T00:00:00Z');
    expect(cardPill(item({ status: 'awaiting_release', releaseDate: '2026-11-12T00:00:00.000Z' }), now)).toBe('Out Nov 12');
    expect(cardPill(item({ status: 'awaiting_release', releaseDate: null }), now)).toBe('Awaiting Release');
    expect(releaseLabel('2027-02-03T00:00:00.000Z', now)).toBe('Out Feb 3, 2027');
    expect(releaseLabel('not a date', now)).toBeNull();
  });

  it('formats durations and sizes', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(null)).toBeNull();
    expect(sizeLabel('1288490188')).toBe('1.2 GB');
    expect(sizeLabel('52428800')).toBe('50 MB');
    expect(sizeLabel(null)).toBeNull();
    expect(sizeLabel('0')).toBeNull();
  });

  it('aria label names title, author and state', () => {
    expect(cardAriaLabel(item({ status: 'failed' }))).toBe('Dune by Frank Herbert, Failed');
  });

  it('marks a deleted requester', () => {
    expect(requesterLabel({ username: 'bob', deleted: true })).toBe('bob (deleted)');
    expect(requesterLabel({ username: 'bob' })).toBe('bob');
  });
});
