/**
 * Component: Discord Request Card Status Logic Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { describe, expect, it } from 'vitest';
import {
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
