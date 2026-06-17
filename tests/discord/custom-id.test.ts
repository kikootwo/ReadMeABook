/**
 * Component: Discord Custom ID Codec Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { describe, expect, it } from 'vitest';
import {
  decodeCustomId,
  encodeCustomId,
  type DiscordCustomId,
} from '@/lib/services/discord/custom-id';

describe('Discord custom ID codec', () => {
  const cases: DiscordCustomId[] = [
    { kind: 'checkout_modal', mediaType: 'audiobook' },
    { kind: 'checkout_modal', mediaType: 'ebook' },
    { kind: 'checkout_select', mediaType: 'audiobook' },
    { kind: 'checkout_confirm', mediaType: 'ebook', asin: 'B0ABCDEFGH' },
    { kind: 'cancel' },
    { kind: 'delete_select' },
    { kind: 'approval', action: 'approve', requestId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
    { kind: 'approval', action: 'deny', requestId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
  ];

  it('round-trips every custom ID kind', () => {
    for (const id of cases) {
      expect(decodeCustomId(encodeCustomId(id))).toEqual(id);
    }
  });

  it('keeps every encoded ID within Discord 100-char limit', () => {
    for (const id of cases) {
      expect(encodeCustomId(id).length).toBeLessThanOrEqual(100);
    }
  });

  it('returns null for unknown or malformed custom IDs', () => {
    expect(decodeCustomId('totally-unknown')).toBeNull();
    expect(decodeCustomId('co:modal:movie')).toBeNull(); // invalid media type
    expect(decodeCustomId('appr:maybe:123')).toBeNull(); // invalid action
    expect(decodeCustomId('co:cf:audiobook')).toBeNull(); // missing asin
  });

  it('decodes approval actions distinctly', () => {
    const approve = decodeCustomId('appr:approve:req-1');
    const deny = decodeCustomId('appr:deny:req-1');
    expect(approve).toEqual({ kind: 'approval', action: 'approve', requestId: 'req-1' });
    expect(deny).toEqual({ kind: 'approval', action: 'deny', requestId: 'req-1' });
  });
});
