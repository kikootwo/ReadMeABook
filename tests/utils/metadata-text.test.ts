/**
 * Component: Metadata Text Helpers Tests
 * Documentation: documentation/phase3/file-organization.md
 */

import { describe, expect, it } from 'vitest';
import {
  capUtf8Bytes,
  describeFfmpegFailure,
  MAX_DESCRIPTION_BYTES,
  MAX_RAW_DESCRIPTION_LENGTH,
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
});
