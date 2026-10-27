/**
 * Component: JSON-safe Serializer Tests (#261)
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { describe, expect, it } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import { toJsonSafe } from '@/lib/utils/json-safe';

describe('toJsonSafe', () => {
  it('turns BigInt values into numbers at any depth', () => {
    const out = toJsonSafe({
      size: BigInt(42),
      nested: { list: [{ bytes: BigInt(7) }, { bytes: null }] },
    });

    expect(out).toEqual({ size: 42, nested: { list: [{ bytes: 7 }, { bytes: null }] } });
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it('leaves Dates, strings, numbers, booleans, null and undefined as they are', () => {
    const when = new Date('2026-10-27T00:00:00.000Z');
    const out = toJsonSafe({ when, name: 'x', n: 1, ok: true, none: null, missing: undefined });

    expect(out.when).toBe(when);
    expect(out).toEqual({ when, name: 'x', n: 1, ok: true, none: null, missing: undefined });
  });

  it('passes a Prisma Decimal through so its own toJSON still applies', () => {
    const rating = new Prisma.Decimal('4.5');
    const out = toJsonSafe({ rating });

    expect(out.rating).toBe(rating);
    expect(JSON.parse(JSON.stringify(out))).toEqual({ rating: '4.5' });
  });

  it('handles a top-level BigInt and top-level arrays', () => {
    expect(toJsonSafe(BigInt(5))).toBe(5);
    expect(toJsonSafe([BigInt(1), 2])).toEqual([1, 2]);
  });
});
