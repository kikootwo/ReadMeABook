/**
 * Component: Ebook extension list tests (one list for detection, serving, import and delete)
 * Documentation: documentation/features/manual-import.md
 */

import { describe, expect, it } from 'vitest';
import { EBOOK_EXTENSIONS } from '@/lib/constants/audio-formats';
import { ORGANIZER_EBOOK_FORMATS, isEbookFile, preferredEbookFile } from '@/lib/utils/import-inventory';

describe('EBOOK_EXTENSIONS', () => {
  it('is the one list, in import preference order, including .azw', () => {
    expect([...EBOOK_EXTENSIONS]).toEqual(['.epub', '.pdf', '.mobi', '.azw3', '.azw', '.fb2', '.cbz', '.cbr']);
  });

  it('is the organizer\'s format list (without dots, same order)', () => {
    expect(ORGANIZER_EBOOK_FORMATS).toEqual(EBOOK_EXTENSIONS.map((ext) => ext.slice(1)));
  });

  it('decides what counts as an ebook file, case-insensitively', () => {
    expect(['a.AZW', 'b.azw3', 'c.Epub', 'd.cbr'].every(isEbookFile)).toBe(true);
    expect(['a.mp3', 'b.m4b', 'c.txt', 'epub'].some(isEbookFile)).toBe(false);
  });

  it('picks the preferred ebook file by format, else undefined', () => {
    expect(preferredEbookFile(['x.cbz', 'x.PDF', 'x.mobi'])).toBe('x.PDF');
    expect(preferredEbookFile(['x.mp3', 'x.txt'])).toBeUndefined();
    expect(preferredEbookFile([])).toBeUndefined();
  });
});
