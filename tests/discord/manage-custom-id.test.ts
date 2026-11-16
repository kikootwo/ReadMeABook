/**
 * Component: Discord /status, Cancel and /delete Custom ID Tests
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The ids carry a page number or a request ID and a nonce, nothing else: no scope, owner or role.
 * Anything not built by the encoders decodes to null.
 */

import { describe, expect, it } from 'vitest';
import {
  CUSTOM_ID_MAX_LENGTH,
  decodeApprovalCustomId,
  decodeManageCustomId,
  decodeRequestCustomId,
  encodePageCustomId,
  encodeRequestActionCustomId,
} from '@/lib/services/discord/discord-custom-id';

const ID = '0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a';
const NONCE = 'abcdefghij';

describe('Discord /status, Cancel and /delete custom ids', () => {
  it.each([
    ['status', 'page', 0, 'rmab:sts:p:0:abcdefghij'],
    ['status', 'menu', 7, 'rmab:sts:m:7:abcdefghij'],
    ['delete', 'page', 999, 'rmab:del:p:999:abcdefghij'],
    ['delete', 'menu', 0, 'rmab:del:m:0:abcdefghij'],
  ] as const)('%s %s page %d round-trips as %s', (area, action, page, encoded) => {
    expect(encodePageCustomId(area, action, page, NONCE)).toBe(encoded);
    expect(decodeManageCustomId(encoded)).toEqual({ area, action, page, nonce: NONCE });
  });

  it('a Cancel button and the Delete confirm carry the request ID only', () => {
    const cancel = encodeRequestActionCustomId('status', ID, NONCE);
    const confirm = encodeRequestActionCustomId('delete', ID, NONCE);
    expect(cancel).toBe(`rmab:sts:x:${ID}:${NONCE}`);
    expect(confirm).toBe(`rmab:del:y:${ID}:${NONCE}`);
    expect(decodeManageCustomId(cancel)).toEqual({ area: 'status', action: 'cancel', requestId: ID, nonce: NONCE });
    expect(decodeManageCustomId(confirm)).toEqual({ area: 'delete', action: 'confirm', requestId: ID, nonce: NONCE });
    expect(confirm.length).toBeLessThanOrEqual(CUSTOM_ID_MAX_LENGTH);
  });

  it('a fresh nonce on every encode', () => {
    expect(encodePageCustomId('status', 'page', 1)).not.toBe(encodePageCustomId('status', 'page', 1));
  });

  it.each([
    `rmab:sts:p:0:all:${NONCE}`,
    `rmab:sts:p:0:${NONCE}:admin`,
    `rmab:sts:a:0:${NONCE}`,
    `rmab:sts:p:-1:${NONCE}`,
    `rmab:sts:p:1000:${NONCE}`,
    `rmab:sts:p:01:${NONCE}`,
    `rmab:sts:p:1.5:${NONCE}`,
    `rmab:sts:p:0:ABCDEFGHIJ`,
    `rmab:sts:y:${ID}:${NONCE}`,
    `rmab:del:x:${ID}:${NONCE}`,
    `rmab:sts:x:not-a-uuid:${NONCE}`,
    `rmab:sts:x:${ID.toUpperCase()}:${NONCE}`,
    `rmab:del:y:${ID}`,
    `rmab:dele:p:0:${NONCE}`,
    `rmab:sts:p:0:${NONCE}${'x'.repeat(90)}`,
    '',
    null,
    42,
  ])('%s decodes to null', (value) => {
    expect(decodeManageCustomId(value)).toBeNull();
  });

  it('the encoders refuse bad input', () => {
    expect(() => encodePageCustomId('status', 'page', -1)).toThrow();
    expect(() => encodePageCustomId('status', 'page', 1000)).toThrow();
    expect(() => encodePageCustomId('status', 'page', 1.5)).toThrow();
    expect(() => encodeRequestActionCustomId('delete', 'x')).toThrow();
    expect(() => encodePageCustomId('status', 'page', 0, 'short')).toThrow();
  });

  it('the other decoders do not accept these ids (and the reverse)', () => {
    const ids = [encodePageCustomId('status', 'page', 0), encodeRequestActionCustomId('status', ID), encodeRequestActionCustomId('delete', ID)];
    for (const id of ids) {
      expect(decodeRequestCustomId(id)).toBeNull();
      expect(decodeApprovalCustomId(id)).toBeNull();
    }
    expect(decodeManageCustomId(`rmab:apr:a:${ID}:${NONCE}`)).toBeNull();
    expect(decodeManageCustomId(`rmab:req:pick:a:${NONCE}`)).toBeNull();
  });
});
