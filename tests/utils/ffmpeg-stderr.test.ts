/**
 * Component: ffmpeg stderr tail and failure reason tests (#580)
 * Documentation: documentation/features/chapter-merging.md
 */

import { describe, expect, it } from 'vitest';
import {
  FFMPEG_ERROR_MAX_CHARS,
  FFMPEG_STDERR_TAIL_CHARS,
  appendStderrTail,
  ffmpegFailureReason,
} from '@/lib/utils/ffmpeg-stderr';

const stats = (s: number) => `size=    1024KiB time=00:00:${String(s % 60).padStart(2, '0')}.00 bitrate= 128.0kbits/s speed=10x    \r`;

describe('ffmpegFailureReason', () => {
  it('skips stats lines (split on \\r and \\n) and keeps the error lines', () => {
    const stderr = `${stats(1)}${stats(2)}frame=  10 fps=0.0 q=-1.0 size=1KiB time=00:00:03.00\r`
      + '[aac @ 0x1] Too many packets buffered\r\n[out#0 @ 0x2] Error muxing a packet\nConversion failed!\n';
    expect(ffmpegFailureReason(stderr, 1)).toBe('[out#0 @ 0x2] Error muxing a packet; Conversion failed!');
  });

  it('carries the reason when ffmpeg names no error word (a missing input)', () => {
    const stderr = `${stats(1)}${stats(2)}/dl/01.mp3: No such file or directory\n`;
    expect(ffmpegFailureReason(stderr, 1)).toBe('/dl/01.mp3: No such file or directory');
  });

  it('without an error line, takes the newest other lines', () => {
    expect(ffmpegFailureReason(`${stats(1)}Output file is empty, nothing was encoded\n`, 1))
      .toBe('Output file is empty, nothing was encoded');
  });

  it('falls back to the exit code when ffmpeg printed nothing but progress', () => {
    expect(ffmpegFailureReason(`${stats(1)}${stats(2)}\n\n`, 254)).toBe('FFmpeg exited with code 254');
    expect(ffmpegFailureReason('', null)).toBe('FFmpeg exited with code null');
  });

  it('keeps the newest error lines, capped in lines and characters', () => {
    const short = Array.from({ length: 20 }, (_, i) => `Error ${i}`).join('\r\n');
    expect(ffmpegFailureReason(short, 1)).toBe('Error 15; Error 16; Error 17; Error 18; Error 19');

    const long = Array.from({ length: 20 }, (_, i) => `Error ${i}: ${'x'.repeat(400)}`).join('\r\n');
    const reason = ffmpegFailureReason(long, 1);
    expect(reason.length).toBeLessThanOrEqual(FFMPEG_ERROR_MAX_CHARS);
    expect(reason).toMatch(/^Error 18: x+; Error 19: x+$/);

    const huge = ffmpegFailureReason(`Error: ${'y'.repeat(5000)}`, 1);
    expect(huge.length).toBeLessThanOrEqual(FFMPEG_ERROR_MAX_CHARS);
    expect(huge.startsWith('Error: yyy')).toBe(true);
  });
});

describe('appendStderrTail', () => {
  it('keeps everything under the limit', () => {
    expect(appendStderrTail('ab', 'cd')).toBe('abcd');
  });

  it('never exceeds the limit over megabytes of progress, and starts at a line', () => {
    let tail = '';
    let fed = 0;
    for (let i = 0; fed < 3 * 1024 * 1024; i++) {
      const chunk = Array.from({ length: 400 }, (_, j) => stats(i + j)).join('');
      fed += chunk.length;
      tail = appendStderrTail(tail, chunk);
      expect(tail.length).toBeLessThanOrEqual(FFMPEG_STDERR_TAIL_CHARS);
    }
    expect(tail.length).toBeGreaterThan(FFMPEG_STDERR_TAIL_CHARS - 1024);
    expect(tail.startsWith('size=')).toBe(true);
  });

  it('with no line break near the cut, never starts with half of a character', () => {
    const book = String.fromCodePoint(0x1f4d6); // two UTF-16 units
    const many = book.repeat(FFMPEG_STDERR_TAIL_CHARS);
    for (const extra of ['a', 'ab']) {
      const kept = appendStderrTail(many, extra);
      expect(kept.length).toBeLessThanOrEqual(FFMPEG_STDERR_TAIL_CHARS);
      expect(kept.endsWith(extra)).toBe(true);
      expect(() => encodeURIComponent(kept)).not.toThrow(); // throws on a lone surrogate
    }
  });
});
