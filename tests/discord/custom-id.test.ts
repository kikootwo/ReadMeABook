/**
 * Component: Discord Request Custom ID Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { describe, expect, it } from 'vitest';
import {
  CUSTOM_ID_MAX_LENGTH,
  decodeRequestCustomId,
  encodeRequestCustomId,
  isAsin,
  type RequestMediaType,
  type RequestStep,
} from '@/lib/services/discord/discord-custom-id';

const ASIN = 'B0ABCDE123';
const NONCE = 'abcdefghij';

describe('Discord request custom ids', () => {
  it.each([
    ['modal', 'audiobook', undefined],
    ['modal', 'ebook', undefined],
    ['pick', 'audiobook', undefined],
    ['pick', 'ebook', undefined],
    ['confirm', 'audiobook', ASIN],
    ['confirm', 'ebook', ASIN],
    ['cancel', 'audiobook', undefined],
  ] as Array<[RequestStep, RequestMediaType, string | undefined]>)('round trip: %s %s', (step, type, asin) => {
    const id = encodeRequestCustomId(step, type, asin);
    expect(id.length).toBeLessThanOrEqual(CUSTOM_ID_MAX_LENGTH);
    const decoded = decodeRequestCustomId(id);
    expect(decoded).toMatchObject({ step, type, ...(asin && { asin }) });
    expect(decoded?.nonce).toMatch(/^[a-z0-9]{10}$/);
    if (!asin) expect(decoded).not.toHaveProperty('asin');
  });

  it('the exact wire format carries step, type, ASIN and nonce only', () => {
    expect(encodeRequestCustomId('confirm', 'ebook', ASIN, NONCE)).toBe(`rmab:req:ok:e:${ASIN}:${NONCE}`);
    expect(encodeRequestCustomId('pick', 'audiobook', undefined, NONCE)).toBe(`rmab:req:pick:a:${NONCE}`);
  });

  it('each id gets a fresh nonce', () => {
    const ids = new Set(Array.from({ length: 50 }, () => encodeRequestCustomId('pick', 'audiobook')));
    expect(ids.size).toBe(50);
  });

  it('an ASIN belongs on confirm only, and must be valid', () => {
    expect(() => encodeRequestCustomId('confirm', 'audiobook')).toThrow();
    expect(() => encodeRequestCustomId('pick', 'audiobook', ASIN)).toThrow();
    expect(() => encodeRequestCustomId('confirm', 'audiobook', 'b0abcde123')).toThrow();
    expect(() => encodeRequestCustomId('pick', 'audiobook', undefined, 'short')).toThrow();
  });

  it.each([
    ['another prefix', `rmab:del:ok:a:${ASIN}:${NONCE}`],
    ['unknown step', `rmab:req:approve:a:${ASIN}:${NONCE}`],
    ['unknown type', `rmab:req:ok:x:${ASIN}:${NONCE}`],
    ['lowercase ASIN', `rmab:req:ok:a:b0abcde123:${NONCE}`],
    ['short ASIN', `rmab:req:ok:a:B0ABC:${NONCE}`],
    ['ASIN with a path', `rmab:req:ok:a:../../etc:${NONCE}`],
    ['confirm without an ASIN', `rmab:req:ok:a:${NONCE}`],
    ['an ASIN on pick', `rmab:req:pick:a:${ASIN}:${NONCE}`],
    ['missing nonce', `rmab:req:pick:a`],
    ['nonce with capitals', 'rmab:req:pick:a:ABCDEFGHIJ'],
    ['nonce too long', 'rmab:req:pick:a:abcdefghijk'],
    ['an extra part', `rmab:req:ok:a:${ASIN}:${NONCE}:admin`],
    ['a user id smuggled in', `rmab:req:ok:a:${ASIN}:222222222222222222:${NONCE}`],
    ['a trailing colon', `rmab:req:pick:a:${NONCE}:`],
    ['an empty string', ''],
    ['the prefix alone', 'rmab:req:'],
  ])('rejects a tampered id: %s', (_label, id) => {
    expect(decodeRequestCustomId(id)).toBeNull();
  });

  it('rejects an id over 100 characters even if every part looks right', () => {
    const oversized = `rmab:req:pick:a:${NONCE}${' '.repeat(100)}`;
    expect(oversized.length).toBeGreaterThan(CUSTOM_ID_MAX_LENGTH);
    expect(decodeRequestCustomId(oversized)).toBeNull();
    expect(decodeRequestCustomId(`rmab:req:pick:a:${'a'.repeat(200)}`)).toBeNull();
  });

  it.each([undefined, null, 42, {}, ['rmab:req:pick:a:abcdefghij']])('rejects a non-string (%j)', (value) => {
    expect(decodeRequestCustomId(value)).toBeNull();
  });

  it.each([
    ['B0ABCDE123', true],
    ['1234567890', true],
    ['b0abcde123', false],
    ['B0ABCDE12', false],
    ['B0ABCDE1234', false],
    ['B0ABCDE12!', false],
  ])('isAsin(%s) = %s', (value, expected) => {
    expect(isAsin(value)).toBe(expected);
  });
});
