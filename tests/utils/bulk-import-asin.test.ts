/**
 * Component: Bulk Import All-Digit ASIN Candidate Tests
 * Documentation: documentation/features/bulk-import.md
 */

import { describe, expect, it } from 'vitest';
import { getLanguageForRegion } from '@/lib/constants/language-config';
import { catalogTitleFitsFolder, extractDigitAsinCandidate } from '@/lib/utils/bulk-import-asin';

const en = getLanguageForRegion('us');

describe('catalogTitleFitsFolder', () => {
  it.each([
    ['Dune, Book 1', 'Dune 0441013597'],
    ["Harry Potter and the Sorcerer's Stone, Book 1", "Harry Potter and the Sorcerer's Stone 0590353403"],
    ['A Quiet Harbor Volume 2', 'A Quiet Harbor 0062976583'],
    ['A Quiet Harbor: Vol. 3', 'A Quiet Harbor 0062976583'],
    ['A Quiet Harbor Part 4', 'A Quiet Harbor 0062976583'],
  ])('fits when the catalog title %j ends in a series position the folder name leaves out', (title, folder) => {
    expect(catalogTitleFitsFolder(title, folder, en)).toBe(true);
  });

  it.each([
    ['Dune Messiah, Book 2', 'Dune 0441013597'],
    ['Gardening for Beginners, Book 1', 'Dune 0441013597'],
    ['Facebook 2', 'Face 0441013597'],
  ])('still rejects the different book %j', (title, folder) => {
    expect(catalogTitleFitsFolder(title, folder, en)).toBe(false);
  });
});

describe('extractDigitAsinCandidate', () => {
  it('takes the last bounded run, where the default template puts {asin}', () => {
    expect(extractDigitAsinCandidate('1234567890 - A Quiet Harbor 0062976583')).toBe('0062976583');
  });

  it('skips a joined run after a bounded one', () => {
    expect(extractDigitAsinCandidate('A Quiet Harbor 0062976583 978-1234567890')).toBe('0062976583');
  });
});
