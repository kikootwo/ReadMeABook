/**
 * Component: Author Initials Matching Tests
 * Documentation: documentation/phase3/ranking-algorithm.md
 */

import { describe, expect, it } from 'vitest';
import { collapseInitials, matchesByInitials } from '@/lib/utils/author-initials';

describe('collapseInitials', () => {
  it.each([
    ['t j klune', 'tj klune'],
    ['george r r martin', 'george rr martin'],
    ['w e b du bois', 'web du bois'],
    ['book 1 t j klune', 'book 1 tj klune'],
    ['book 1 2 3', 'book 1 2 3'],
    ['j smith', 'j smith'],
    ['a game by t j klune', 'a game by tj klune'],
    ['  t  j   klune ', 'tj klune'],
    ['', ''],
  ])('"%s" -> "%s"', (input, expected) => {
    expect(collapseInitials(input)).toBe(expected);
  });
});

describe('matchesByInitials', () => {
  it('matches collapsed initials on word boundaries only', () => {
    expect(matchesByInitials('olive juice by t j klune', 'tj klune')).toBe(true);
    expect(matchesByInitials('olive juice by tj klune', 't j klune')).toBe(true);
    expect(matchesByInitials('fifty shades by michael james', 'e l james')).toBe(false);
    expect(matchesByInitials('galaxy proxy', 'x y')).toBe(false);
  });

  it('never matches an empty author', () => {
    expect(matchesByInitials('any title', '')).toBe(false);
  });
});
