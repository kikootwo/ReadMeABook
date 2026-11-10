/**
 * Component: ASIN shape helpers tests (typed ASIN for Bulk Import Change match, #189)
 * Documentation: documentation/features/bulk-import.md
 */

import { describe, expect, it } from 'vitest';
import { asinShaped, typedAsin } from '@/lib/utils/asin';

describe('typedAsin', () => {
  it.each([
    ['B0ABCDEFGH', 'B0ABCDEFGH'],
    ['  b0abcdefgh ', 'B0ABCDEFGH'],
    ['1460793501', '1460793501'],
    ['177424855x', '177424855X'],
  ])('reads "%s" as an ASIN', (value, asin) => {
    expect(typedAsin(value)).toBe(asin);
  });

  it.each(['Foundation', 'Bloodlines', 'BLOODLINES', 'B1ABCDEFGH', 'B0ABCDEFG', 'B0ABCDEFGHI', '12345678XX', 'B0ABC-EFGH', '', null, undefined])(
    'keeps "%s" a text search',
    (value) => {
      expect(typedAsin(value)).toBeNull();
    },
  );

  it('is stricter than the shape the import accepts', () => {
    expect(asinShaped('Foundation')).toBe('Foundation');
    expect(typedAsin('Foundation')).toBeNull();
  });
});
