/**
 * Component: Discord Approve / Deny Custom ID Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * `rmab:apr:<a|d>:<request id>:<nonce>`: names the request only (the clicker is checked on
 * every click); anything not built by the encoder decodes to null.
 */

import { describe, expect, it } from 'vitest';
import {
  APPROVAL_CUSTOM_ID_PREFIX,
  CUSTOM_ID_MAX_LENGTH,
  decodeApprovalCustomId,
  decodeRequestCustomId,
  encodeApprovalCustomId,
} from '@/lib/services/discord/discord-custom-id';

const ID = '0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a';
const NONCE = 'abcdefghij';

describe('Discord approval custom ids', () => {
  it.each(['approve', 'deny'] as const)('%s round-trips and stays within Discord\'s limit', (action) => {
    const id = encodeApprovalCustomId(action, ID, NONCE);
    expect(id).toBe(`${APPROVAL_CUSTOM_ID_PREFIX}${action === 'approve' ? 'a' : 'd'}:${ID}:${NONCE}`);
    expect(id.length).toBeLessThanOrEqual(CUSTOM_ID_MAX_LENGTH);
    expect(decodeApprovalCustomId(id)).toEqual({ action, requestId: ID, nonce: NONCE });
  });

  it('a fresh nonce on every encode', () => {
    expect(encodeApprovalCustomId('approve', ID)).not.toBe(encodeApprovalCustomId('approve', ID));
  });

  it.each([
    ['unknown action', `rmab:apr:x:${ID}:${NONCE}`],
    ['request ID not a UUID', `rmab:apr:a:req-1:${NONCE}`],
    ['upper-case UUID', `rmab:apr:a:${ID.toUpperCase()}:${NONCE}`],
    ['short nonce', `rmab:apr:a:${ID}:abc`],
    ['extra part', `rmab:apr:a:${ID}:${NONCE}:admin`],
    ['missing part', `rmab:apr:a:${ID}`],
    ['other prefix', `rmab:req:a:${ID}:${NONCE}`],
    ['oversized', `rmab:apr:a:${ID}:${NONCE}${'x'.repeat(100)}`],
    ['not a string', 42],
  ])('%s → null', (_label, value) => {
    expect(decodeApprovalCustomId(value)).toBeNull();
  });

  it('the encoder refuses anything but a request UUID and a valid nonce', () => {
    expect(encodeApprovalCustomId('approve', ID, 'abcdefghij')).toBe(`rmab:apr:a:${ID}:abcdefghij`);
    expect(() => encodeApprovalCustomId('approve', 'req-1')).toThrow('Invalid request ID');
    expect(() => encodeApprovalCustomId('approve', ID, 'bad')).toThrow('Invalid nonce');
  });

  it('approval and /request ids never decode as each other', () => {
    expect(decodeRequestCustomId(encodeApprovalCustomId('approve', ID))).toBeNull();
  });
});
