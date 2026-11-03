/**
 * Component: MP4 Movie Timescale tests (#511)
 * Documentation: documentation/phase3/file-organization.md
 *
 * The capability probe (`ffmpeg -h muxer=mp4`) and the argv of both MP4
 * writers: the tagger's MP4 remux and the chapter merger. Real-binary
 * behaviour: metadata-tagger.chapters.integration.test.ts.
 */

import { EventEmitter } from 'events';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { movieTimescaleArgs, resetMovieTimescaleProbe } from '@/lib/utils/mp4-movie-timescale';
import { tagAudioFileMetadata } from '@/lib/utils/metadata-tagger';
import { mergeChapters, type ChapterFile } from '@/lib/utils/chapter-merger';

/** `ffmpeg -h muxer=mp4` lines around the option (9.0.2 prints "(default 0)", 8.x "(default 1000)"). */
const HELP_LISTED = [
  'Muxer mp4 [MP4 (MPEG-4 Part 14)]:',
  '  -movflags          <flags>      E.......... MOV muxer flags (default 0)',
  '  -movie_timescale   <int>        E.......... set movie timescale (from 0 to INT_MAX) (default 0)',
  '  -write_tmcd        <boolean>    E.......... force or disable writing tmcd (default auto)',
].join('\n');
/** A pre-5.0 build: same table, no -movie_timescale (a similar name must not match). */
const HELP_UNLISTED = [
  'Muxer mp4 [MP4 (MPEG-4 Part 14)]:',
  '  -movflags          <flags>      E.......... MOV muxer flags (default 0)',
  '  -write_tmcd        <boolean>    E.......... force or disable writing tmcd (default auto)',
  '  -use_editlist      <boolean>    E.......... use edit list (default auto); see -movie_timescale_x',
].join('\n');

const help = vi.hoisted(() => ({ mode: 'listed' as 'listed' | 'unlisted' | 'fail' }));
const isProbe = (file: string, args: string[]) => file === 'ffmpeg' && args.includes('muxer=mp4');
const execFileMock = vi.hoisted(() => {
  const execFile = vi.fn();
  // promisify(execFile) -> { stdout, stderr }; records the raw (file, args, options) call
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = async (
    file: string,
    args: string[],
    options?: unknown
  ) => {
    execFile(file, args, options);
    if (file === 'ffmpeg' && args.includes('muxer=mp4')) {
      if (help.mode === 'fail') throw new Error('spawn ffmpeg ENOENT');
      return { stdout: help.mode === 'listed' ? HELP_LISTED : HELP_UNLISTED, stderr: '' };
    }
    const stdout = file === 'ffprobe' ? JSON.stringify({ format: { duration: '120', bit_rate: '128000', tags: {} } }) : '';
    return { stdout, stderr: '' };
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
const debugLog = vi.hoisted(() => [] as string[]);

vi.mock('child_process', () => ({ execFile: execFileMock, spawn: spawnMock }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));
vi.mock('@/lib/utils/logger', () => {
  const log = { debug: (m: string) => debugLog.push(m), info: () => undefined, warn: () => undefined, error: () => undefined };
  return { RMABLogger: { create: () => log, forJob: () => log } };
});
vi.mock('@/lib/utils/mp4-freeform-tags', () => ({ addFreeformTags: async () => ({ written: false }) }));
// Merge verification input: a 120 s output from two 60 s chapters
vi.mock('@/lib/utils/audio-content', () => ({
  probeAudioContent: vi.fn(async (p: string) => {
    const contentMs = p.endsWith('out.m4b') ? 120000 : 60000;
    return { contentMs, gapMs: 0, frameMs: 1, framedMs: contentMs, endMs: contentMs, packets: contentMs, decodedFormat: '44100/2/stereo/fltp' };
  }),
}));

function exitingProcess() {
  const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  setImmediate(() => proc.emit('close', 0));
  return proc;
}

const chapter = (p: string): ChapterFile => ({ path: p, filename: path.basename(p), duration: 60000, bitrate: 128, chapterTitle: 'Chapter' });
const probeCalls = () => execFileMock.mock.calls.filter(([file, args]) => isProbe(file as string, args as string[]));
const BOOK = { title: 'Book', author: 'Author' };

/** The tagger's ffmpeg argv for `file` (the last non-probe execFile call). */
async function tagArgv(file: string): Promise<string[]> {
  const result = await tagAudioFileMetadata(file, BOOK);
  expect(result.success).toBe(true);
  const call = execFileMock.mock.calls.filter(([f, a]) => !isProbe(f as string, a as string[])).at(-1);
  return call![1] as string[];
}

async function mergeArgv(ext: '.m4a' | '.mp3'): Promise<string[]> {
  const result = await mergeChapters([chapter(`/dl/01${ext}`), chapter(`/dl/02${ext}`)], { ...BOOK, outputPath: '/t/out.m4b' });
  expect(result.success).toBe(true);
  return spawnMock.mock.calls.at(-1)![1] as string[];
}

/** The pair appears exactly once, adjacent, before `-movflags` and the output. */
function expectFlagBefore(argv: string[], marker: string): void {
  expect(argv.filter((a) => a === '-movie_timescale')).toHaveLength(1);
  const i = argv.indexOf('-movie_timescale');
  expect(argv[i + 1]).toBe('1000');
  expect(i).toBeLessThan(argv.indexOf(marker));
  expect(i).toBeLessThan(argv.length - 1);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMovieTimescaleProbe();
  help.mode = 'listed';
  debugLog.length = 0;
  for (const fn of [fsMock.access, fsMock.writeFile, fsMock.mkdir, fsMock.unlink]) fn.mockResolvedValue(undefined);
  fsMock.stat.mockResolvedValue({ size: 1024 * 1024 });
  spawnMock.mockImplementation(() => exitingProcess());
});

describe('movieTimescaleArgs (capability probe)', () => {
  it('passes -movie_timescale 1000 when the mp4 muxer lists the option', async () => {
    expect(await movieTimescaleArgs()).toEqual(['-movie_timescale', '1000']);
    expect(probeCalls()).toEqual([['ffmpeg', ['-hide_banner', '-h', 'muxer=mp4'], { timeout: 15_000 }]]);
  });

  it('passes nothing when the muxer does not list it (ffmpeg older than 5.0 rejects the option)', async () => {
    help.mode = 'unlisted';
    expect(await movieTimescaleArgs()).toEqual([]);
  });

  it('probes once per process, also for concurrent callers', async () => {
    const results = await Promise.all([movieTimescaleArgs(), movieTimescaleArgs()]);
    await movieTimescaleArgs();
    help.mode = 'unlisted'; // the cached answer stands
    expect(await movieTimescaleArgs()).toEqual(['-movie_timescale', '1000']);
    expect(results).toEqual([['-movie_timescale', '1000'], ['-movie_timescale', '1000']]);
    expect(probeCalls()).toHaveLength(1);
  });

  it('a failed probe passes nothing, is logged once at debug, and is retried by the next call', async () => {
    help.mode = 'fail';
    expect(await movieTimescaleArgs()).toEqual([]);
    expect(await movieTimescaleArgs()).toEqual([]);
    expect(debugLog.filter((m) => m.includes('probe failed'))).toHaveLength(1);
    expect(debugLog[0]).toContain('spawn ffmpeg ENOENT');

    help.mode = 'listed';
    expect(await movieTimescaleArgs()).toEqual(['-movie_timescale', '1000']);
    expect(probeCalls()).toHaveLength(3);
  });
});

describe('metadata tagger MP4 argv', () => {
  it.each(['/tmp/book.m4b', '/tmp/book.m4a', '/tmp/book.mp4'])('%s: the flag sits before -movflags and -f mp4', async (file) => {
    const argv = await tagArgv(file);
    expectFlagBefore(argv, '-movflags');
    expect(argv.indexOf('-movflags')).toBeLessThan(argv.indexOf('-f'));
    expect(argv.at(-1)).toBe(`${file}.tmp`);
  });

  it('leaves the MP4 argv unchanged when the option is not listed', async () => {
    help.mode = 'unlisted';
    const argv = await tagArgv('/tmp/book.m4b');
    expect(argv).not.toContain('-movie_timescale');
    expect(argv.slice(-5)).toEqual(['-movflags', '+faststart', '-f', 'mp4', '/tmp/book.m4b.tmp']);
  });

  it.each(['/tmp/book.mp3', '/tmp/book.flac'])('%s: never gets the flag (and never probes)', async (file) => {
    const argv = await tagArgv(file);
    expect(argv).not.toContain('-movie_timescale');
    expect(probeCalls()).toHaveLength(0);
  });
});

describe('chapter merger argv', () => {
  it.each(['.m4a', '.mp3'] as const)('%s merge (copy / re-encode): the flag sits before -movflags', async (ext) => {
    expectFlagBefore(await mergeArgv(ext), '-movflags');
  });

  it('leaves the merge argv without the flag when the option is not listed', async () => {
    help.mode = 'unlisted';
    expect(await mergeArgv('.m4a')).not.toContain('-movie_timescale');
  });
});
