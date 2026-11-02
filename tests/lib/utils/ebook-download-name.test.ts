/**
 * Component: E-book Direct Download File Name Tests (#474)
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { describe, expect, it } from 'vitest';
import { buildEbookDownloadName } from '@/lib/utils/ebook-download-name';

const bytes = (value: string) => Buffer.byteLength(value, 'utf8');

describe('buildEbookDownloadName', () => {
  it.each([
    ['Title', 'Author', 'epub', 'Title - Author.epub'],
    ['Mistborn: The <Final> Empire', 'Brandon   Sanderson', 'epub', 'Mistborn The Final Empire - Brandon Sanderson.epub'],
    // No 100-character cap per part: a long Latin name that fits is kept whole
    ['T'.repeat(150), 'Author', 'epub', `${'T'.repeat(150)} - Author.epub`],
    // Exactly 255 bytes
    ['T'.repeat(241), 'Author', 'epub', `${'T'.repeat(241)} - Author.epub`],
  ])('unchanged when it fits: %s', (title, author, format, expected) => {
    expect(buildEbookDownloadName(title, author, format)).toBe(expected);
  });

  it('cuts the title first and keeps the author whole', () => {
    const name = buildEbookDownloadName('T'.repeat(300), 'Firstname Middlename Lastname', 'epub');
    expect(name).toBe(`${'T'.repeat(218)} - Firstname Middlename Lastname.epub`);
    expect(bytes(name)).toBe(255);
  });

  it('a long author: the title keeps half the room, the author the rest', () => {
    const name = buildEbookDownloadName('吾'.repeat(200), '著'.repeat(200), 'epub');
    expect(bytes(name)).toBeLessThanOrEqual(255);
    expect(name).toBe(`${'吾'.repeat(41)} - ${'著'.repeat(41)}.epub`);
  });

  it.each([
    ['pdf', 254],
    ['fb2', 254],
    ['any', 254],
    ['epub', 255],
    ['azw3', 255],
  ])('a name queued as .%s is cut to %i bytes so a .epub swapped in still fits', (format, max) => {
    const name = buildEbookDownloadName('T'.repeat(300), 'Author', format);
    expect(bytes(name)).toBe(max);
    const swapped = `${name.replace(/\.[^.]+$/, '')}.epub`;
    expect(bytes(swapped)).toBeLessThanOrEqual(255);
  });
});
