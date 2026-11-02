/**
 * Component: Audible Category Tree Parser Tests (#309)
 * Documentation: documentation/features/home-sections.md
 */

import { describe, expect, it } from 'vitest';
import { parseCatalogCategories } from '@/lib/integrations/audible-categories';

describe('parseCatalogCategories()', () => {
  it('skips malformed entries, a repeated child and a child with its parent\'s id', () => {
    const parsed = parseCatalogCategories({
      categories: [
        { id: '1', name: ' Fiction ', children: [
          { id: '1', name: 'Self' },
          { id: '2', name: 'Horror' },
          { id: '2', name: 'Horror again' },
          { id: '', name: 'No id' },
          { id: '3' },
          'junk',
        ] },
        { name: 'No id' },
        { id: '1', name: 'Repeated top' },
        { id: 4, name: 'Numeric id', children: 'not a list' },
      ],
    });

    expect(parsed).toEqual([
      { id: '1', name: 'Fiction', subcategories: [{ id: '2', name: 'Horror', parentId: '1' }] },
      { id: '4', name: 'Numeric id', subcategories: [] },
    ]);
  });

  it('returns an empty list for a missing or malformed envelope', () => {
    expect(parseCatalogCategories(undefined)).toEqual([]);
    expect(parseCatalogCategories({})).toEqual([]);
    expect(parseCatalogCategories({ categories: 'x' })).toEqual([]);
  });
});
