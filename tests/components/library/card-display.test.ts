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
  GROUP_TONE,
  STATUS_GROUP_DOTS,
  STATUS_GROUP_LABELS,
  TONE_DOT,
  TONE_TEXT,
  releaseLabel,
  requesterLabel,
  showsProgress,
  sizeLabel,
} from '@/components/library/card-display';
import { STATUS_GROUP_OF } from '@/lib/library-view/constants';
import { item, scanItem } from './fixtures';

describe('card display', () => {
  it.each([
    ['available', 'emerald'],
    ['downloading', 'amber'],
    ['processing', 'amber'],
    ['downloaded', 'amber'],
    ['awaiting_import', 'amber'],
    ['pending', 'amber'],
    ['awaiting_search', 'amber'],
    ['searching', 'amber'],
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

  it('labels are StatusBadge wording in sentence case, like the rest of the page', () => {
    expect(cardLabel(item({ status: 'awaiting_approval' }))).toBe('Pending approval');
    expect(cardLabel(item({ status: 'awaiting_release' }))).toBe('Awaiting release');
    expect(cardLabel(item({ status: 'denied' }))).toBe('Request denied');
    expect(cardLabel(item({ status: 'searching' }))).toBe('Searching...');
  });

  it('one colour per status group: every status of a group has its dot, and the rail uses the same', () => {
    for (const [status, group] of Object.entries(STATUS_GROUP_OF)) {
      const tone = coverTone(item({ status, statusGroup: group }));
      expect(tone, status).toBe(GROUP_TONE[group]);
      expect(STATUS_GROUP_DOTS[group], status).toBe(TONE_DOT[tone]);
    }
    // the group a live patch moved the card to wins over a stale statusGroup
    expect(coverTone(item({ status: 'pending', statusGroup: 'problem' }))).toBe('amber');
  });

  it('rail labels match the cards and tiles', () => {
    expect(STATUS_GROUP_LABELS.available).toBe('In your library');
    expect(STATUS_GROUP_LABELS.needs_approval).toBe(cardLabel(item({ status: 'awaiting_approval' })));
    expect(STATUS_GROUP_LABELS.awaiting_release).toBe(cardLabel(item({ status: 'awaiting_release' })));
    expect(STATUS_GROUP_LABELS.denied).toBe(cardLabel(item({ status: 'denied' })));
  });

  it('the amber status line is dark enough for small text on white (amber-700, not amber-600)', () => {
    expect(TONE_TEXT.amber).toContain('text-amber-700');
    expect(TONE_TEXT.amber).not.toContain('text-amber-600');
  });

  it('downloading shows the percentage in the pill and the meta line, and the bar', () => {
    const dl = item({ status: 'downloading', statusGroup: 'on_the_way', progress: 41.6 });
    expect(cardPill(dl)).toBe('Downloading 42%');
    expect(cardMeta(dl)).toBe('Downloading · 42%');
    expect(showsProgress(dl)).toBe(true);
    expect(showsProgress(item({ status: 'processing' }))).toBe(false);
  });

  it('processing says what it is doing: a percent and the bar only while chapters merge (#216)', () => {
    const merging = item({ status: 'processing', statusGroup: 'on_the_way', progress: 42 });
    expect(cardPill(merging)).toBe('Merging chapters 42%');
    expect(cardMeta(merging)).toBe('Merging chapters · 42%');
    expect(showsProgress(merging)).toBe(true);
    expect(cardMeta(item({ status: 'processing', statusGroup: 'on_the_way', progress: 0 }))).toBe('Merging chapters · 0%');

    for (const progress of [100, null]) {
      const organizing = item({ status: 'processing', statusGroup: 'on_the_way', progress });
      expect(cardPill(organizing)).toBe('Organizing files');
      expect(cardMeta(organizing)).toBe('Organizing files');
      expect(showsProgress(organizing)).toBe(false);
    }
    // Other statuses keep their wording, whatever progress holds
    expect(cardMeta(item({ status: 'downloaded', statusGroup: 'on_the_way', progress: 42 }))).toBe('Downloaded');
  });

  it('awaiting release shows the release date when known', () => {
    const now = new Date('2026-11-09T00:00:00Z');
    expect(cardPill(item({ status: 'awaiting_release', releaseDate: '2026-11-12T00:00:00.000Z' }), now)).toBe('Out Nov 12');
    expect(cardPill(item({ status: 'awaiting_release', releaseDate: null }), now)).toBe('Awaiting release');
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
