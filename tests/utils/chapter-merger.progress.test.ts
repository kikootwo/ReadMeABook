/**
 * Component: Chapter merge progress callback tests (#216)
 * Documentation: documentation/features/chapter-merging.md
 *
 * mergeChapters reports 0 as ffmpeg starts, whole-percent changes of ffmpeg's
 * `time=` capped at 99, and 100 once ffmpeg has exited, on every exit path.
 */

import { EventEmitter } from 'events';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeChapters, type ChapterFile } from '@/lib/utils/chapter-merger';
import { MERGE_PROGRESS_WRITE_INTERVAL_MS, createMergeProgressReporter } from '@/lib/utils/merge-progress';

const execFileMock = vi.hoisted(() => {
  const execFile = vi.fn();
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = (
    file: string,
    args: string[],
    options?: unknown
  ) => {
    execFile(file, args, options);
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
// Measured chapter audio: 60 s each unless a test sets it (the total the percent divides by)
const content = vi.hoisted(() => ({ chapterMs: 60000 as number | null }));

const updateMany = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ prisma: { request: { updateMany } } }));
vi.mock('child_process', () => ({ execFile: execFileMock, spawn: spawnMock }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));
vi.mock('@/lib/utils/audio-content', () => ({
  probeAudioContent: vi.fn(async (p: string) => {
    if (content.chapterMs === null && !p.endsWith('.m4b')) throw new Error('unreadable');
    const contentMs = p.endsWith('.m4b') ? 2 * (content.chapterMs ?? 60000) : content.chapterMs ?? 60000;
    return { contentMs, gapMs: 0, frameMs: 1, framedMs: contentMs, endMs: contentMs, packets: contentMs, decodedFormat: '44100/2/stereo/fltp' };
  }),
}));

type FakeFfmpeg = EventEmitter & { stderr: EventEmitter; kill: ReturnType<typeof vi.fn> };

function fakeFfmpeg(): FakeFfmpeg {
  const proc = new EventEmitter() as FakeFfmpeg;
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

/** One ffmpeg run that prints these stderr chunks (one per tick), then exits with `code`. */
function scriptedFfmpeg(chunks: string[], code = 0) {
  return () => {
    const proc = fakeFfmpeg();
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

const stats = (time: string) => `size=  1024kB time=${time} bitrate= 128.0kbits/s speed=10x\r`;
const chapter = (p: string): ChapterFile => ({ path: p, filename: path.basename(p), duration: 60000, bitrate: 128, chapterTitle: 'Chapter' });
const merge = (onProgress?: (p: number) => void, ext = 'mp3') =>
  mergeChapters([chapter(`/dl/01.${ext}`), chapter(`/dl/02.${ext}`)], { title: 'B', author: 'A', outputPath: '/t/out.m4b', onProgress });

beforeEach(() => {
  vi.clearAllMocks();
  updateMany.mockReset();
  content.chapterMs = 60000;
  fsMock.access.mockResolvedValue(undefined);
  fsMock.mkdir.mockResolvedValue(undefined);
  fsMock.writeFile.mockResolvedValue(undefined);
  fsMock.unlink.mockResolvedValue(undefined);
  fsMock.stat.mockImplementation(async (p: string) => (p.endsWith('.m4b') ? { size: 2 * 1024 * 1024 } : { size: 500 * 1024 }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('chapter merge progress', () => {
  it('reports 0 first, rising whole percents capped at 99 while ffmpeg runs, then 100 after it exits', async () => {
    // Total 120 s: 30 s = 25 %, 60 s = 50 %, 90 s = 75 %, 120 s = 100 % (shown as 99 until exit)
    spawnMock.mockImplementation(scriptedFfmpeg([
      stats('00:00:30.00'), stats('00:00:30.50'), stats('00:01:00.00'), stats('00:01:30.00'), stats('00:02:00.00'),
    ]));
    const seen: number[] = [];

    const result = await merge((p) => seen.push(p));

    expect(result.success).toBe(true);
    expect(seen).toEqual([0, 25, 50, 75, 99, 100]); // 30.5 s is still 25 %: no repeat
  });

  it('takes the newest stats line of a chunk (a busy event loop hands over several)', async () => {
    spawnMock.mockImplementation(scriptedFfmpeg([stats('00:00:12.00') + stats('00:00:24.00') + stats('00:00:36.00')]));
    const seen: number[] = [];
    await merge((p) => seen.push(p));
    expect(seen).toEqual([0, 30, 100]);
  });

  it('parses three-digit hours (an output over 99 hours)', async () => {
    content.chapterMs = 100 * 3600 * 1000; // two chapters of 100 h: 200 h in all
    spawnMock.mockImplementation(scriptedFfmpeg([stats('100:00:00.00')]));
    const seen: number[] = [];
    await merge((p) => seen.push(p), 'm4a');
    expect(seen).toEqual([0, 50, 100]);
  });

  it.each([
    ['exits non-zero', () => scriptedFfmpeg([stats('00:00:30.00'), 'Error while encoding\n'], 1)],
    ['cannot be spawned', () => () => {
      const proc = fakeFfmpeg();
      setImmediate(() => proc.emit('error', new Error('spawn ffmpeg ENOENT')));
      return proc;
    }],
  ])('sends 100 when ffmpeg %s, and the merge fails as before', async (_label, make) => {
    spawnMock.mockImplementation(make());
    const seen: number[] = [];
    const result = await merge((p) => seen.push(p));
    expect(result.success).toBe(false);
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(100);
  });

  it('sends 100 when ffmpeg times out (the merge fails at once, before ffmpeg has gone)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const proc = fakeFfmpeg();
    spawnMock.mockImplementation(() => proc);
    const seen: number[] = [];

    const pending = merge((p) => seen.push(p));
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    proc.stderr.emit('data', Buffer.from(stats('00:00:30.00')));
    await vi.advanceTimersByTimeAsync(91 * 60 * 1000); // re-encode timeout: 90 min at least
    const result = await pending;

    expect(proc.kill).toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('timeout') });
    expect(seen).toEqual([0, 25, 100]);
    // ffmpeg's last stats line after the kill still reaches the callback: the reporter
    // is closed by the 100 by then (merge-progress.test.ts), so nothing is written
    proc.stderr.emit('data', Buffer.from(stats('00:01:30.00')));
    expect(seen).toEqual([0, 25, 100, 75]);
  });

  it('with the request reporter, progress ffmpeg prints after a timeout rejection writes nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    updateMany.mockResolvedValue({ count: 1 });
    const proc = fakeFfmpeg();
    spawnMock.mockImplementation(() => proc);
    const reporter = createMergeProgressReporter('req-1');

    const pending = merge((p) => reporter.report(p));
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(MERGE_PROGRESS_WRITE_INTERVAL_MS + 1);
    proc.stderr.emit('data', Buffer.from(stats('00:00:30.00')));
    await vi.advanceTimersByTimeAsync(91 * 60 * 1000);
    await pending;
    // SIGTERM: ffmpeg finishes its trailer and prints a last stats line, long after the 100
    proc.stderr.emit('data', Buffer.from(stats('00:01:44.00')));
    await vi.advanceTimersByTimeAsync(MERGE_PROGRESS_WRITE_INTERVAL_MS * 3);
    await reporter.settle();

    const progress = updateMany.mock.calls.map((c) => c[0].data.progress);
    expect(progress[progress.length - 1]).toBe(100);
    expect(progress).not.toContain(86);
  });

  it('a throwing callback never fails the merge or escapes the stderr listener', async () => {
    spawnMock.mockImplementation(scriptedFfmpeg([stats('00:00:30.00'), stats('00:01:00.00')]));
    const onProgress = vi.fn(() => {
      throw new Error('db gone');
    });

    const result = await merge(onProgress);

    expect(result.success).toBe(true);
    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([0, 25, 50, 100]);
  });

  it('reports nothing when the chapters total no audio (no percent can be computed)', async () => {
    content.chapterMs = null; // not measurable: the merge keeps the estimates, here 0
    spawnMock.mockImplementation(scriptedFfmpeg([stats('00:00:30.00')]));
    const onProgress = vi.fn();
    const zero = (p: string): ChapterFile => ({ ...chapter(p), duration: 0 });
    await mergeChapters([zero('/dl/01.m4a'), zero('/dl/02.m4a')], { title: 'B', author: 'A', outputPath: '/t/out.m4b', onProgress });
    expect(spawnMock).toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('reports nothing when the merge stops before ffmpeg starts', async () => {
    fsMock.stat.mockImplementation(async (p: string) => ({ size: p === '/dl/02.mp3' ? 0 : 500 * 1024 }));
    const onProgress = vi.fn();
    const result = await merge(onProgress);
    expect(result.success).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('without a callback the merge runs as before', async () => {
    spawnMock.mockImplementation(scriptedFfmpeg([stats('00:01:00.00')]));
    await expect(merge()).resolves.toMatchObject({ success: true });
  });
});
