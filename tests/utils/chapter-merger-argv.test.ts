/**
 * Component: Chapter Merger argv / list-file safety tests
 * Documentation: documentation/features/chapter-merging.md
 *
 * Untrusted paths and tag values must reach ffmpeg/ffprobe as untouched argv
 * elements (no shell), and must not be able to add lines to the concat list
 * or the ffmetadata chapter file.
 */

import { EventEmitter } from 'events';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeChapters, probeAudioFile, type ChapterFile } from '@/lib/utils/chapter-merger';

const probeState = vi.hoisted(() => ({ duration: '120' }));
const execFileMock = vi.hoisted(() => {
  const execFile = vi.fn();
  // promisify(execFile) -> { stdout, stderr }; records the raw (file, args, options) call
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = (
    file: string,
    args: string[],
    options?: unknown
  ) => {
    execFile(file, args, options);
    const stdout = file === 'ffprobe'
      ? JSON.stringify({ format: { duration: probeState.duration, bit_rate: '128000', tags: {} } })
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

vi.mock('child_process', () => ({ execFile: execFileMock, spawn: spawnMock }));
// Measured audio content used to verify a merge (per file path), and timeline gaps
const streamDurations = vi.hoisted(() => ({ byPath: new Map<string, number>(), gaps: new Map<string, number>(), ends: new Map<string, number>(), formats: new Map<string, string>(), fallback: 60000 }));
vi.mock('@/lib/utils/audio-content', () => ({
  probeAudioContent: vi.fn(async (p: string) => {
    // Merged outputs default to the mocked container duration; chapters to 60 s
    const fallback = p.endsWith('out.m4b') ? Number(probeState.duration) * 1000 : streamDurations.fallback;
    const contentMs = streamDurations.byPath.get(p) ?? fallback;
    // 1 ms frames: a codec-copy output verifies only when its content equals the chapters' total
    return { contentMs, gapMs: streamDurations.gaps.get(p) ?? 0, frameMs: 1, framedMs: contentMs, endMs: streamDurations.ends.get(p) ?? contentMs, packets: contentMs, decodedFormat: streamDurations.formats.get(p) ?? '44100/2/stereo/fltp' };
  }),
}));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));
const HOSTILE_DIR = '/dl/My $(touch pwned) `id` "dq" \'sq\' Book';

function createSpawnProcess() {
  const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  setImmediate(() => proc.emit('close', 0));
  return proc;
}

function chapter(p: string, chapterTitle = 'Chapter'): ChapterFile {
  return { path: p, filename: path.basename(p), duration: 60000, bitrate: 128, chapterTitle };
}

/** Content written to the temp file whose name starts with `prefix` (concat_ / chapters_). */
function writtenFile(prefix: string): { file: string; content: string } | undefined {
  const call = fsMock.writeFile.mock.calls.find(([file]: [string]) => path.basename(file).startsWith(prefix));
  return call ? { file: call[0], content: String(call[1]) } : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  probeState.duration = '120';
  streamDurations.byPath.clear();
  streamDurations.gaps.clear();
  streamDurations.ends.clear();
  streamDurations.formats.clear();
  streamDurations.fallback = 60000;
  fsMock.access.mockResolvedValue(undefined);
  fsMock.mkdir.mockResolvedValue(undefined);
  fsMock.writeFile.mockResolvedValue(undefined);
  fsMock.unlink.mockResolvedValue(undefined);
  fsMock.stat.mockImplementation(async (filePath: string) =>
    filePath.endsWith('.m4b') ? { size: 2 * 1024 * 1024 } : { size: 500 * 1024 }
  );
  spawnMock.mockImplementation(() => createSpawnProcess());
});

describe('chapter merge verification', () => {
  it('never uses -xerror: a single bad frame must not drop the merge (durationVerified guards deletes)', async () => {
    await mergeChapters([chapter('/dl/01.mp3'), chapter('/dl/02.mp3')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });
    await mergeChapters([chapter('/dl/01.m4a'), chapter('/dl/02.m4a')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });

    for (const call of spawnMock.mock.calls) {
      expect(call[1] as string[]).not.toContain('-xerror');
    }
  });

  it('marks the duration verified when the merged file matches the chapters', async () => {
    streamDurations.byPath.set('/t/out.m4b', 120000);
    const result = await mergeChapters([chapter('/dl/01.m4a'), chapter('/dl/02.m4a')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });

    expect(result.success).toBe(true);
    expect(result.durationVerified).toBe(true);
  });

  it('keeps a codec-copy merge but does not verify it when audio packets are missing', async () => {
    // 1.2 s short passes the 2% merge check; a copy must carry every packet
    streamDurations.byPath.set('/t/out.m4b', 118800);

    const result = await mergeChapters([chapter('/dl/01.m4a'), chapter('/dl/02.m4a')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });

    expect(result.success).toBe(true);
    expect(result.durationVerified).toBe(false);
  });

  it('fails a re-encoded merge (files organized individually) that holds over 1 s less audio', async () => {
    // Two 60 s chapters: 1.2 s short; a surplus may reach 1.1 s, a shortfall only 1 s
    streamDurations.byPath.set('/t/out.m4b', 118800);

    const result = await mergeChapters([chapter('/dl/01.mp3'), chapter('/dl/02.mp3')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('re-encoded audio is 1.2 s shorter than the chapters');
    expect(fsMock.unlink).toHaveBeenCalledWith('/t/out.m4b');
  });

  it('re-encodes chapters of one decoded format with timestamps rebuilt from the sample count', async () => {
    await mergeChapters([chapter('/dl/01.mp3'), chapter('/dl/02.mp3')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args[args.indexOf('-af') + 1]).toBe('asetpts=N/SR/TB');
  });

  it('keeps container timestamps when the chapters decode differently (a filter graph rebuild would restart the count) or for codec copy', async () => {
    streamDurations.formats.set('/dl/02.mp3', '22050/1/mono/fltp');
    await mergeChapters([chapter('/dl/01.mp3'), chapter('/dl/02.mp3')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });
    expect(spawnMock.mock.calls[0][1] as string[]).not.toContain('-af');

    spawnMock.mockClear();
    await mergeChapters([chapter('/dl/01.m4a'), chapter('/dl/02.m4a')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });
    expect(spawnMock.mock.calls[0][1] as string[]).not.toContain('-af');
  });

  it('fails the merge (files organized individually) when the merged timeline has a gap, even at the full length', async () => {
    // A chapter that ended early, or timestamps offset by a chapter's estimated duration
    streamDurations.byPath.set('/t/out.m4b', 120000);
    streamDurations.gaps.set('/t/out.m4b', 2600);

    const result = await mergeChapters([chapter('/dl/01.mp3'), chapter('/dl/02.mp3')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Merged file rejected: the merged timeline has 2.6 s of gaps');
    expect(fsMock.unlink).toHaveBeenCalledWith('/t/out.m4b');
  });

  it('fails the merge when the merged timeline ends far from its audio', async () => {
    streamDurations.byPath.set('/t/out.m4b', 120000);
    streamDurations.ends.set('/t/out.m4b', 121200); // window for 2 chapters: 1.1 s

    const result = await mergeChapters([chapter('/dl/01.mp3'), chapter('/dl/02.mp3')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('ends at 121.2 s but holds 120.0 s of audio');
  });

  it('does not verify when a chapter cannot be probed', async () => {
    streamDurations.byPath.set('/dl/02.m4a', 0);
    streamDurations.byPath.set('/t/out.m4b', 120000);

    const result = await mergeChapters([chapter('/dl/01.m4a'), chapter('/dl/02.m4a')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });

    expect(result.durationVerified).toBe(false);
  });
});

describe('chapter merge output and timeout', () => {
  const merge = () => mergeChapters([chapter('/dl/01.m4a'), chapter('/dl/02.m4a')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });
  const failingFfmpeg = () => {
    const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    setImmediate(() => proc.emit('close', 1));
    return proc;
  };

  it('never passes an ASIN to ffmpeg (its mp4 muxer drops freeform keys; the organizer adds it)', async () => {
    await merge();
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args.some((a) => a.includes('ASIN'))).toBe(false);
  });

  it('a failure after ffmpeg started removes its output (no orphaned partial file)', async () => {
    spawnMock.mockImplementation(failingFfmpeg);
    const result = await merge();
    expect(result.success).toBe(false);
    expect(fsMock.unlink).toHaveBeenCalledWith('/t/out.m4b');
  });

  it('an early failure (empty source, before ffmpeg) leaves a file already at the output path alone', async () => {
    // Another job's finished merge of a same-titled book may sit at that path
    fsMock.stat.mockImplementation(async (filePath: string) => ({ size: filePath === '/dl/02.m4a' ? 0 : 500 * 1024 }));
    const result = await merge();
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('empty') });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(fsMock.unlink).not.toHaveBeenCalledWith('/t/out.m4b');
  });

  it('codec copy: the timeout is at least the size-scaled +faststart allowance', async () => {
    fsMock.stat.mockImplementation(async (filePath: string) => ({ size: filePath.endsWith('.m4b') ? 2 * 1024 * 1024 : 1.5 * 1024 ** 3 }));
    const info = vi.fn(async () => undefined);
    const logger = { info, warn: vi.fn(async () => undefined), error: vi.fn(async () => undefined) };
    await mergeChapters([chapter('/dl/01.m4a'), chapter('/dl/02.m4a')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' }, logger as never);
    // estimate 3 GiB x 1.1 = 3.3 GiB: 120 s + 3.3 x 120 s = 516 s (9 min) > 5 min + 2 x 30 s
    expect(info).toHaveBeenCalledWith('Executing FFmpeg merge (timeout: 9 minutes)...');
  });
});

describe('chapter merger argv safety (no shell)', () => {
  it('probes with execFile and the path as one untouched argv element', async () => {
    const filePath = `${HOSTILE_DIR}/01.m4a`;

    await probeAudioFile(filePath);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: 30000 }
    );
  });

  it('passes every path verbatim and restricts concat inputs to the file protocol', async () => {
    const outputPath = `${HOSTILE_DIR}/out.m4b`;
    const chapters = [chapter(`${HOSTILE_DIR}/01.m4a`), chapter(`${HOSTILE_DIR}/02.m4a`)];

    const result = await mergeChapters(chapters, { title: 'Book', author: 'Author', outputPath });

    expect(result.success).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args, spawnOptions] = spawnMock.mock.calls[0] as [string, string[], unknown];
    expect(bin).toBe('ffmpeg');
    expect(spawnOptions).toBeUndefined();
    expect(args.slice(0, 7)).toEqual(['-y', '-f', 'concat', '-safe', '0', '-protocol_whitelist', 'file']);
    // The concat input is exactly the list file that was written; output path is last and unquoted
    const concat = writtenFile('concat_');
    expect(concat).toBeDefined();
    expect(args[args.indexOf('-i') + 1]).toBe(concat!.file);
    expect(args[args.length - 1]).toBe(outputPath);

    // Decode checks get the output path as its own argv element
    const decodeCalls = execFileMock.mock.calls.filter(
      ([file, a]: [string, string[]]) => file === 'ffmpeg' && a.includes('null')
    );
    expect(decodeCalls).toHaveLength(2);
    for (const [, a] of decodeCalls) {
      expect(a[a.indexOf('-i') + 1]).toBe(outputPath);
    }
  });

  it("writes concat entries with ' escaped as '\\'' and tabs kept verbatim", async () => {
    const chapters = [chapter("/dl/O'Brien's Book/01.m4a"), chapter('/dl/Tab\tBook/02.m4a')];

    const result = await mergeChapters(chapters, { title: 'Book', author: 'Author', outputPath: '/tmp/out.m4b' });

    expect(result.success).toBe(true);
    expect(writtenFile('concat_')!.content).toBe(
      "file '/dl/O'\\''Brien'\\''s Book/01.m4a'\nfile '/dl/Tab\tBook/02.m4a'"
    );
  });

  it('uses the measured content for the chapter markers', async () => {
    streamDurations.byPath.set('/dl/01.m4a', 61234);
    await mergeChapters([chapter('/dl/01.m4a'), chapter('/dl/02.m4a')], { title: 'B', author: 'A', outputPath: '/t/out.m4b' });
    const markers = writtenFile('chapters_')!.content;
    expect(markers).toContain('START=0\nEND=61234\n');
    expect(markers).toContain('START=61234\nEND=121234\n');
  });

  it.each([
    ['newline', '\n'],
    ['carriage return', '\r'],
    ['NUL', '\0'],
  ])('refuses to merge when a directory name holds a %s (no injected concat line)', async (_label, ch) => {
    const badPath = `/dl/Book${ch}file '/etc/passwd/01.m4a`;
    const chapters = [chapter('/dl/ok/00.m4a'), chapter(badPath)];

    const result = await mergeChapters(chapters, { title: 'Book', author: 'Author', outputPath: '/tmp/out.m4b' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('line break or NUL');
    expect(result.error).toContain(JSON.stringify(badPath));
    expect(writtenFile('concat_')).toBeUndefined();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('strips CR, LF and NUL from chapter titles so a title cannot add a chapter', async () => {
    const chapters = [
      chapter('/dl/a/01.m4a', 'One\r[CHAPTER]\rTIMEBASE=1/1000\rSTART=0\rEND=1\rtitle=Bogus'),
      chapter('/dl/a/02.m4a', 'Two\nthree\0four'),
    ];

    const result = await mergeChapters(chapters, { title: 'Book', author: 'Author', outputPath: '/tmp/out.m4b' });

    expect(result.success).toBe(true);
    const metadata = writtenFile('chapters_')!.content;
    expect(metadata).not.toMatch(/[\r\0]/);
    expect(metadata.match(/^\[CHAPTER\]$/gm)).toHaveLength(2);
    expect(metadata).toContain('title=Twothreefour\n');
  });
});
