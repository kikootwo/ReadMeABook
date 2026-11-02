/**
 * Component: Metadata Text Helpers Tests
 * Documentation: documentation/phase3/file-organization.md
 */

import { describe, expect, it } from 'vitest';
import {
  bookDetailValues,
  capUtf8Bytes,
  describeFfmpegFailure,
  languageTagValue,
  MAX_DESCRIPTION_BYTES,
  MAX_RAW_DESCRIPTION_LENGTH,
  MAX_SHORT_TAG_BYTES,
  sanitizeMetadataValue,
  sanitizeShortTagValue,
  truncateRawText,
} from '@/lib/utils/metadata-text';

describe('metadata text helpers', () => {
  it.each([
    ['2-byte', '\u00e9'],
    ['4-byte', '\u{1f600}'],
  ])('caps %s multibyte text without splitting a code point', (_label, char) => {
    const text = char.repeat(20_000); // no spaces: cut at the byte limit
    const capped = capUtf8Bytes(text, MAX_DESCRIPTION_BYTES);

    expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(MAX_DESCRIPTION_BYTES);
    expect(capped.endsWith('\u2026')).toBe(true);
    expect(capped).not.toContain('\ufffd');
    expect(Buffer.from(capped, 'utf8').toString('utf8')).toBe(capped); // no lone surrogate
    expect(text.startsWith(capped.slice(0, -1))).toBe(true);
  });

  it('leaves a description that fits unchanged', () => {
    const exact = 'a'.repeat(MAX_DESCRIPTION_BYTES);
    expect(capUtf8Bytes(exact, MAX_DESCRIPTION_BYTES)).toBe(exact);
  });

  it('cuts raw text to its bound without splitting a surrogate pair', () => {
    expect(truncateRawText('aaa\u{1f600}b', 4)).toBe('aaa');
    expect(truncateRawText('aaa\u{1f600}b', 5)).toBe('aaa\u{1f600}');
    expect(truncateRawText('short', 10)).toBe('short');
    expect(truncateRawText('x'.repeat(MAX_RAW_DESCRIPTION_LENGTH + 5))).toHaveLength(MAX_RAW_DESCRIPTION_LENGTH);
    expect(MAX_RAW_DESCRIPTION_LENGTH).toBe(4 * MAX_DESCRIPTION_BYTES);
  });

  it.each([
    [0, 'abcdef', ''],
    [1, 'abcdef', 'a'],
    [2, 'abcdef', 'ab'],
    [1, '\u00e9\u00e9', ''],
    [3, 'abcdef', '\u2026'],
  ])('caps at maxBytes %i without going over (no ellipsis below 3 bytes)', (maxBytes, text, expected) => {
    const capped = capUtf8Bytes(text, maxBytes);
    expect(capped).toBe(expected);
    expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(maxBytes);
  });

  it.each([
    ['no stderr', Object.assign(new Error('Command failed: ffmpeg -metadata description=SECRET\nboom'), { code: 1 }), 'boom'],
    ['killed', Object.assign(new Error('Command failed: ffmpeg -metadata description=SECRET'), { killed: true, signal: 'SIGTERM' }), 'ffmpeg was stopped (SIGTERM)'],
    ['only the command line', Object.assign(new Error('Command failed: ffmpeg -metadata description=SECRET'), { code: 2 }), 'exit code 2'],
    ['a plain error', new Error('spawn ffmpeg ENOENT'), 'spawn ffmpeg ENOENT'],
  ])('describeFfmpegFailure: %s', (_label, error, expected) => {
    expect(describeFfmpegFailure(error)).toBe(expected);
  });

  it.each([
    ['a BOM', '\uFEFF'],
    ['an NBSP', '\u00A0'],
    ['a zero-width space', '\u200B'],
    ['a zero-width non-joiner', '\u200C'],
    ['a zero-width joiner', '\u200D'],
  ])('sanitizeMetadataValue drops a leading run of %s, and keeps one inside the value', (_label, char) => {
    expect(sanitizeMetadataValue(`${char}${char}Title`)).toBe('Title');
    expect(sanitizeMetadataValue(`Ti${char}tle`)).toBe(`Ti${char}tle`);
  });

  describe('sanitizeShortTagValue (publisher, subtitle)', () => {
    it.each([
      ['surrounding and inner whitespace runs', '  Penguin \t Audio \r\n ', 'Penguin Audio'],
      ['control characters', 'Pen\u0000gu\u0007in', 'Penguin'],
      ['a lone surrogate (the MP4 read-back compares bytes)', 'Before \ud800 after', 'Before \uFFFD after'],
      ['U+FFFE and U+FFFF (ffprobe does not read them back as written)', 'A \uFFFE B \uFFFF C', 'A \uFFFD B \uFFFD C'],
      ['other noncharacters, which read back as written', 'A \uFDD0 B \u{10ffff}', 'A \uFDD0 B \u{10ffff}'],
      ['a valid surrogate pair', 'Smile \u{1f600}', 'Smile \u{1f600}'],
    ])('cleans %s', (_label, input, expected) => {
      expect(sanitizeShortTagValue(input)).toBe(expected);
    });

    it.each([[undefined], [null], [''], ['   '], ['\r\n\t'], [42], [{ name: 'Penguin' }]])('is undefined for %j', (input) => {
      expect(sanitizeShortTagValue(input)).toBeUndefined();
    });

    it('caps a long value at MAX_SHORT_TAG_BYTES with an ellipsis', () => {
      const capped = sanitizeShortTagValue('word '.repeat(1000))!;
      expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(MAX_SHORT_TAG_BYTES);
      expect(capped.endsWith('word\u2026')).toBe(true);
    });
  });

  describe('languageTagValue', () => {
    it.each([
      ['english', 'English'],
      ['german', 'German'],
      [' english ', 'English'],
      ['English', 'English'],
    ])('%j becomes %j (the name Audiobookshelf shows, not an ISO code)', (input, expected) => {
      expect(languageTagValue(input)).toBe(expected);
    });

    it.each([[undefined], [''], ['  '], [7]])('is undefined for %j', (input) => {
      expect(languageTagValue(input)).toBeUndefined();
    });

    it('stays within MAX_SHORT_TAG_BYTES when the capital letter is longer', () => {
      // U+0149 (2 bytes) upper-cases to U+02BC U+004E (3 bytes)
      const value = languageTagValue('\u0149' + 'n'.repeat(MAX_SHORT_TAG_BYTES - 2))!;
      expect(value.startsWith('\u02BCN')).toBe(true);
      expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(MAX_SHORT_TAG_BYTES);
    });
  });

  it('bookDetailValues sanitizes all three, empty ones undefined', () => {
    expect(bookDetailValues({ publisher: ' Penguin\nAudio ', subtitle: ' ', language: 'english' })).toEqual({
      publisher: 'Penguin Audio',
      subtitle: undefined,
      language: 'English',
    });
  });
});
