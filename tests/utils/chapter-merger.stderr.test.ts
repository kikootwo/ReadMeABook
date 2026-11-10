/**
 * Component: Chapter merge ffmpeg stderr tests (#580)
 * Documentation: documentation/features/chapter-merging.md
 *
 * The merge keeps a bounded tail of ffmpeg's stderr, and a failed merge's error
 * carries ffmpeg's last meaningful lines, never its `\r`-ended progress history.
 */

import { EventEmitter } from 'events';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeChapters, type ChapterFile } from '@/lib/utils/chapter-merger';

/** FFMPEG_ERROR_MAX_CHARS in ffmpeg-stderr.ts (a literal here, so this file runs against older code too) */
const ERROR_MAX_CHARS = 1000;

const execFileMock = vi.hoisted(() => {
  const execFile = vi.fn();
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = (file: string) => {
    const stdout = file === 'ffprobe'
      ? JSON.stringify({ format: { duration: '120', bit_rate: '128000', tags: {} } })
      : '';
    return Promise.resolve({ stdout, stderr: '' });
  };
  return execFile;
});
const spawnMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  constants: { R_OK: 4 },
}));

vi.mock('@/lib/db', () => ({ prisma: { request: { updateMany: vi.fn() } } }));
vi.mock('child_process', () => ({ execFile: execFileMock, spawn: spawnMock }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));
vi.mock('@/lib/utils/audio-content', () => ({
  probeAudioContent: vi.fn(async (p: string) => {
    const contentMs = p.endsWith('.m4b') ? 120000 : 60000;
    return { contentMs, gapMs: 0, frameMs: 1, framedMs: contentMs, endMs: contentMs, packets: contentMs, decodedFormat: '44100/2/stereo/fltp' };
  }),
}));

type FakeFfmpeg = EventEmitter & { stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };

/** One ffmpeg run that prints these stderr chunks (one per tick), then exits with `code`. */
function scriptedFfmpeg(chunks: string[], code: number) {
  return () => {
    const proc = new EventEmitter() as FakeFfmpeg;
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    (async () => {
      for (const chunk of chunks) {
        await new Promise((r) => setImmediate(r));
        proc.stderr.emit('data', Buffer.from(chunk));
      }
      await new Promise((r) => setImmediate(r));
      proc.emit('close', code);
    })();
    return proc;
  };
}

const stats = (s: number) =>
  `size=    1024KiB time=00:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.00 bitrate= 128.0kbits/s speed=10x    \r`;

/** About `mb` megabytes of `\r`-ended stats lines (time 0..119 s, repeating), in ~32 KB chunks. */
function progressChunks(mb: number): string[] {
  const chunks: string[] = [];
  let chunk = '';
  let total = 0;
  for (let i = 0; total < mb * 1024 * 1024; i++) {
    const line = stats(i % 120);
    chunk += line;
    total += line.length;
    if (chunk.length >= 32 * 1024) {
      chunks.push(chunk);
      chunk = '';
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

const chapter = (p: string): ChapterFile => ({ path: p, filename: path.basename(p), duration: 60000, bitrate: 128, chapterTitle: 'Chapter' });
const merge = (onProgress?: (p: number) => void) =>
  mergeChapters([chapter('/dl/01.mp3'), chapter('/dl/02.mp3')], { title: 'B', author: 'A', outputPath: '/t/out.m4b', onProgress });

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.access.mockResolvedValue(undefined);
  fsMock.mkdir.mockResolvedValue(undefined);
  fsMock.writeFile.mockResolvedValue(undefined);
  fsMock.unlink.mockResolvedValue(undefined);
  fsMock.stat.mockImplementation(async (p: string) => (p.endsWith('.m4b') ? { size: 2 * 1024 * 1024 } : { size: 500 * 1024 }));
});

describe('chapter merge ffmpeg stderr', () => {
  it('a failed run after megabytes of progress reports the real reason, short, with no progress line', async () => {
    // ffmpeg's first error line follows the last `\r`-ended stats line on the same `\n` line
    const failure = '[aac @ 0x55d0] Error submitting a packet to the muxer\n'
      + '[out#0/ipod @ 0x55d1] Error muxing a packet\nConversion failed!\n';
    spawnMock.mockImplementation(scriptedFfmpeg([...progressChunks(4), stats(100), failure], 1));

    const result = await merge();

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^FFmpeg merge failed: /);
    expect(result.error).toContain('Error muxing a packet');
    expect(result.error).toContain('Conversion failed!');
    expect(result.error).not.toMatch(/time=|size=|\r|\n/);
    expect(result.error!.length).toBeLessThanOrEqual('FFmpeg merge failed: '.length + ERROR_MAX_CHARS);
  });

  it('a failed run whose reason has no error word still carries it', async () => {
    spawnMock.mockImplementation(scriptedFfmpeg([stats(1), '/dl/01.mp3: No such file or directory\n'], 1));
    const result = await merge();
    expect(result).toMatchObject({ success: false, error: 'FFmpeg merge failed: /dl/01.mp3: No such file or directory' });
  });

  it('a successful run with megabytes of progress is unchanged and still reports progress', async () => {
    spawnMock.mockImplementation(scriptedFfmpeg([...progressChunks(4), stats(119) + '\n'], 0));
    const seen: number[] = [];

    const result = await merge((p) => seen.push(p));

    expect(result.success).toBe(true);
    expect(seen[0]).toBe(0);
    expect(seen).toContain(99);
    expect(seen[seen.length - 1]).toBe(100);
  });
});
