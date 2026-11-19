/**
 * Component: Credit Lists Tests
 * Documentation: documentation/frontend/components.md
 */

import { describe, expect, it } from 'vitest';
import { creditLine, parseCredits, summarizeNames } from '@/lib/utils/credits';

describe('parseCredits', () => {
  it('splits names and roles', () => {
    expect(parseCredits('Terry Pratchett, Ben Aaranovitch - introduction')).toEqual([
      { name: 'Terry Pratchett' },
      { name: 'Ben Aaranovitch', role: 'introduction' },
    ]);
  });

  it('keeps a name suffix with its name', () => {
    expect(parseCredits('Martin Luther King, Jr., Clayborne Carson - editor')).toEqual([
      { name: 'Martin Luther King, Jr.' },
      { name: 'Clayborne Carson', role: 'editor' },
    ]);
  });

  it('keeps hyphenated names whole', () => {
    expect(parseCredits('Julie-Ann Elliott')).toEqual([{ name: 'Julie-Ann Elliott' }]);
  });

  it('returns nothing for an empty value', () => {
    expect(parseCredits('')).toEqual([]);
    expect(parseCredits(null)).toEqual([]);
  });
});

describe('summarizeNames', () => {
  it.each([
    [['A'], 'A'],
    [['A', 'B'], 'A and B'],
    [['A', 'B', 'C'], 'A, B and 1 more'],
    [['A', 'B', 'C', 'D', 'E'], 'A, B and 3 more'],
    [[], ''],
  ])('%j → %s', (names, expected) => {
    expect(summarizeNames(names)).toBe(expected);
  });
});

describe('creditLine', () => {
  it('leaves role credits out of the summary and names them in the full list', () => {
    expect(creditLine('Matt Dinniman, Ruggero Leò - translator')).toEqual({
      summary: 'Matt Dinniman',
      full: 'Matt Dinniman, Ruggero Leò (translator)',
    });
  });

  it('uses the role credits when every credit has a role', () => {
    expect(creditLine('Neil Gaiman - editor').summary).toBe('Neil Gaiman');
  });

  it('shortens a full cast', () => {
    const cast = 'Amanda Forstrom, Andy Clemence, Julie-Ann Elliott, Laura C. Harris, Richard Rohan';
    expect(creditLine(cast)).toEqual({ summary: 'Amanda Forstrom, Andy Clemence and 3 more', full: cast });
  });
});
