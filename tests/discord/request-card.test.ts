/**
 * Component: Discord Request Card Status Logic Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { describe, expect, it } from 'vitest';
import {
  buildSearchSelect,
  isCancellableStatus,
  requestStatusFooter,
} from '@/lib/services/discord/embeds';

describe('request card status footer', () => {
  it('shows pre-decision states without an approval marker', () => {
    expect(requestStatusFooter('awaiting_approval')).toBe('⏳ Awaiting Admin Approval');
    expect(requestStatusFooter('denied')).toBe('🚫 Request Denied');
    expect(requestStatusFooter('cancelled')).toBe('🚫 Request Cancelled');
  });

  it('joins approval marker + download stage with a separating dot once approved', () => {
    expect(requestStatusFooter('searching')).toBe('✅ Approved • 🔎 Searching');
    expect(requestStatusFooter('downloading')).toBe('✅ Approved • ⬇️ Downloading');
    expect(requestStatusFooter('downloaded')).toBe('✅ Approved • 📚 Download Complete');
    expect(requestStatusFooter('failed')).toBe('✅ Approved • ❌ Download Failed');
  });
});

describe('request cancellability', () => {
  it('allows cancelling while pending or in flight', () => {
    for (const status of [
      'pending',
      'awaiting_approval',
      'searching',
      'downloading',
      'processing',
    ]) {
      expect(isCancellableStatus(status)).toBe(true);
    }
  });

  it('disallows cancelling once terminal', () => {
    for (const status of ['available', 'downloaded', 'denied', 'cancelled', 'failed']) {
      expect(isCancellableStatus(status)).toBe(false);
    }
  });
});

describe('search result dropdown', () => {
  const book = {
    asin: 'B0TEST0001',
    title: 'Dungeon Crawler Carl',
    author: 'Matt Dinniman',
    narrator: 'Jeff Hays',
    releaseDate: '2021-08-06',
  } as any;

  const descriptionOf = (mediaType: 'audiobook' | 'ebook') =>
    (buildSearchSelect([book], mediaType).components[0] as any).options[0].data.description as string;

  it('lists the narrator for audiobook results', () => {
    expect(descriptionOf('audiobook')).toContain('Narrated by Jeff Hays');
  });

  it('omits the narrator for e-book results', () => {
    // Narrator is audiobook-only; an e-book has none, so advertising one is misleading.
    expect(descriptionOf('ebook')).not.toContain('Narrated by');
  });

  it('keeps author and year on both media types', () => {
    for (const mediaType of ['audiobook', 'ebook'] as const) {
      expect(descriptionOf(mediaType)).toContain('Matt Dinniman');
      expect(descriptionOf(mediaType)).toContain('2021');
    }
  });
});
