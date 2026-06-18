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
    { kind: 'request_modal', mediaType: 'audiobook' },
    { kind: 'request_modal', mediaType: 'ebook' },
    { kind: 'request_select', mediaType: 'audiobook' },
    { kind: 'request_confirm', mediaType: 'ebook', asin: 'B0ABCDEFGH' },
    { kind: 'cancel' },
    { kind: 'delete_select' },
    { kind: 'approval', action: 'approve', requestId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
    { kind: 'approval', action: 'deny', requestId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
    { kind: 'cancel_request', requestId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
    { kind: 'status_page', page: 0, scopeAll: false },
    { kind: 'status_cancel', page: 2, scopeAll: true },
    { kind: 'delete_page', page: 1, scopeAll: false },
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
    expect(decodeCustomId('req:modal:movie')).toBeNull(); // invalid media type
    expect(decodeCustomId('appr:maybe:123')).toBeNull(); // invalid action
    expect(decodeCustomId('req:cf:audiobook')).toBeNull(); // missing asin
    expect(decodeCustomId('st:pg::1')).toBeNull(); // empty page segment (Number('') === 0)
    expect(decodeCustomId('st:pg:-5:1')).toBeNull(); // negative page
    expect(decodeCustomId('del:pg:1.5:0')).toBeNull(); // fractional page
    expect(decodeCustomId('st:cx:abc:0')).toBeNull(); // non-numeric page
  });

  it('decodes approval actions distinctly', () => {
    const approve = decodeCustomId('appr:approve:req-1');
    const deny = decodeCustomId('appr:deny:req-1');
    expect(approve).toEqual({ kind: 'approval', action: 'approve', requestId: 'req-1' });
    expect(deny).toEqual({ kind: 'approval', action: 'deny', requestId: 'req-1' });
  });
});
