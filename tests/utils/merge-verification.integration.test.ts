/**
 * Component: Chapter Merge Source Verification Tests (real ffmpeg/ffprobe)
 * Documentation: documentation/features/chapter-merging.md
 *
 * Real merges of generated chapters, checked against the DECODED output:
 * complete merges must verify; merges that lost audio (a chapter read short
 * or missing during the merge, an output cut short) must not, even when the
 * output still ends at full length. Skips when ffmpeg/ffprobe are not on PATH
 * (CI and the Docker image have them).
 */

import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Real child_process. A test can act around the merge's ffmpeg run: before it
// starts (after the chapters were measured) and when it exits (before
// mergeChapters inspects the output), to simulate inputs or output going bad.
const hooks = vi.hoisted(() => ({ before: null as null | (() => void), after: null as null | (() => void) }));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const spawn = ((cmd: string, args: readonly string[], ...rest: unknown[]) => {
    const merging = cmd === 'ffmpeg' && args.includes('concat');
    if (merging) hooks.before?.();
    const child = (actual.spawn as (...a: unknown[]) => import('child_process').ChildProcess)(cmd, args, ...rest);
    if (merging && hooks.after) child.on('close', hooks.after);
    return child;
  }) as typeof actual.spawn;
  return { ...actual, spawn };
});

import { analyzeChapterFiles, mergeChapters } from '@/lib/utils/chapter-merger';
import { probeAudioContent } from '@/lib/utils/audio-content';
import { mergeToleranceMs, verifyMergedFile } from '@/lib/utils/merge-verification';

const execFileP = promisify(execFile);

function has(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const available = has('ffmpeg') && has('ffprobe');
const hasLame = available && execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes('libmp3lame');

async function ffmpeg(args: string[]) {
  // One thread: these tests run beside the rest of the suite
  await execFileP('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', ...args]);
}

/** Pink noise (a realistic bitrate, unlike a pure tone), optionally loud only for its first seconds. */
async function noise(file: string, seconds: number, codec: string[], loudSeconds = 0) {
  const af = loudSeconds > 0 ? ['-af', `volume='if(lt(t,${loudSeconds}),1,0.02)':eval=frame`] : [];
  await ffmpeg(['-f', 'lavfi', '-i', `anoisesrc=d=${seconds}:c=pink:a=0.4`, ...af, ...codec, file]);
}

/** Decoded length (ms): what a player actually gets. Cached per file and size (sources are re-read). */
const decodedCache = new Map<string, number>();
function decodedMs(file: string): number {
  const key = `${file}:${fs.statSync(file).size}`;
  const cached = decodedCache.get(key);
  if (cached !== undefined) return cached;
  const ms = decodeMs(file);
  decodedCache.set(key, ms);
  return ms;
}

function decodeMs(file: string): number {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-i', file, '-f', 's16le', '-ac', '1', '-ar', '8000', '-'], { maxBuffer: 1 << 30 });
  return Math.round((pcm.length / 2 / 8000) * 1000);
}

const decodedTotal = (files: string[]) => files.reduce((sum, f) => sum + decodedMs(f), 0);

async function chapterStartsMs(file: string): Promise<number[]> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', file]);
  return (JSON.parse(stdout).chapters as { start_time: string }[]).map((c) => Math.round(parseFloat(c.start_time) * 1000));
}

/** Chapter markers start where the previous chapters' decoded audio ends. */
async function expectMarkersMatch(output: string, files: string[]) {
  const starts = await chapterStartsMs(output);
  expect(starts).toHaveLength(files.length);
  let at = 0;
  for (let i = 0; i < files.length; i++) {
    expect(Math.abs(starts[i] - at)).toBeLessThanOrEqual(mergeToleranceMs(i + 1));
    at += decodedMs(files[i]);
  }
}

let dir: string;

async function chapters(name: string, count: number, seconds: number, codec: string[], ext: string, loudSeconds = 0) {
  const files: string[] = [];
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  for (let i = 1; i <= count; i++) {
    const file = path.join(dir, name, `${String(i).padStart(2, '0')} - Chapter.${ext}`);
    await noise(file, seconds, codec, loudSeconds);
    files.push(file);
  }
  return files;
}

/** Merge for real and return the result plus the merged file's decoded length. */
async function merge(files: string[], name: string) {
  const outputPath = path.join(dir, 'out', `${name}.m4b`);
  const result = await mergeChapters(await analyzeChapterFiles(files), { title: 'Book', author: 'Author', outputPath });
  return { result, outputPath, decoded: fs.existsSync(outputPath) ? decodedMs(outputPath) : 0 };
}

describe('mergeToleranceMs', () => {
  it('is 1 s plus 50 ms per chapter, far tighter than the old percentage window on long books', () => {
    expect(mergeToleranceMs(13)).toBe(1650);
    // 12 x 60 min + 20 min: the old window was min(2% of total, half the shortest chapter) = 10 minutes
    const oldWindowMs = Math.min(0.02 * (12 * 60 + 20) * 60_000, (20 * 60_000) / 2);
    expect(oldWindowMs).toBe(600_000);
    expect(mergeToleranceMs(13)).toBeLessThan(oldWindowMs / 300);
  });
});

describe.skipIf(!available)('merge verification on real audio (decoded)', () => {
  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-merge-verify-')));
    fs.mkdirSync(path.join(dir, 'out'));
  });

  afterAll(() => {
    hooks.before = hooks.after = null;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('12 AAC chapters (codec copy) verify; the output decodes to the chapters\' total; markers at the boundaries', async () => {
    const files = await chapters('aac', 12, 6, ['-c:a', 'aac', '-b:a', '96k'], 'm4a');
    const { result, outputPath, decoded } = await merge(files, 'aac');

    expect(result.success).toBe(true);
    expect(result.durationVerified).toBe(true);
    expect(Math.abs(decoded - decodedTotal(files))).toBeLessThanOrEqual(mergeToleranceMs(12));
    await expectMarkersMatch(outputPath, files);
  }, 180_000);

  it('.m4b parts verify, one marker per part', async () => {
    const m4a = await chapters('parts-src', 3, 8, ['-c:a', 'aac', '-b:a', '96k'], 'm4a');
    const parts = [];
    for (const file of m4a) {
      const part = file.replace(/\.m4a$/, '.m4b');
      await ffmpeg(['-i', file, '-c', 'copy', '-f', 'mp4', part]);
      parts.push(part);
    }
    const { result, outputPath, decoded } = await merge(parts, 'parts');

    expect(result.durationVerified).toBe(true);
    expect(Math.abs(decoded - decodedTotal(parts))).toBeLessThanOrEqual(mergeToleranceMs(3));
    await expectMarkersMatch(outputPath, parts);
  }, 180_000);

  it('FLAC chapters (re-encoded) verify and decode to their total', async () => {
    const files = await chapters('flac', 3, 8, ['-c:a', 'flac'], 'flac');
    const { result, decoded } = await merge(files, 'flac');

    expect(result.durationVerified).toBe(true);
    expect(Math.abs(decoded - decodedTotal(files))).toBeLessThanOrEqual(mergeToleranceMs(3));
  }, 180_000);

  it('a merge whose output was cut short after ffmpeg exited is not verified; sources stay', async () => {
    const files = await chapters('cut', 3, 30, ['-c:a', 'aac', '-b:a', '96k'], 'm4a');
    hooks.after = () => {
      const output = path.join(dir, 'out', 'cut.m4b');
      const tmp = `${output}.cut.m4b`;
      // 1.5 s of 90 s lost: inside the 2% merge check (1.8 s), outside 1.15 s
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', output, '-t', '88.5', '-c', 'copy', '-map_chapters', '-1', '-f', 'mp4', tmp]);
      fs.renameSync(tmp, output);
    };
    try {
      const { result, decoded } = await merge(files, 'cut');
      expect(result.success).toBe(true);
      expect(result.durationVerified).toBe(false);
      expect(decodedTotal(files) - decoded).toBeGreaterThan(mergeToleranceMs(3));
      for (const source of files) expect(fs.existsSync(source)).toBe(true);
    } finally {
      hooks.after = null;
    }
  }, 180_000);

  it('a chapter missing during the merge never yields a verified merge', async () => {
    const files = await chapters('missing', 3, 6, ['-c:a', 'aac', '-b:a', '96k'], 'm4a');
    const hidden = `${files[2]}.hidden`;
    hooks.before = () => fs.renameSync(files[2], hidden);
    hooks.after = () => fs.renameSync(hidden, files[2]);
    try {
      const { result } = await merge(files, 'missing');
      expect(result.success && result.durationVerified).toBe(false);
    } finally {
      hooks.before = hooks.after = null;
      if (fs.existsSync(hidden)) fs.renameSync(hidden, files[2]);
    }
  }, 180_000);

  it('a merged file missing its last chapter is not verified', async () => {
    const files = await chapters('partial', 3, 6, ['-c:a', 'aac', '-b:a', '96k'], 'm4a');
    const partial = path.join(dir, 'out', 'partial.m4b');
    const list = path.join(dir, 'partial', 'two.txt');
    fs.writeFileSync(list, files.slice(0, 2).map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-f', 'mp4', partial]);

    const verification = await verifyMergedFile(files, partial);

    expect(verification.verified).toBe(false);
    expect((verification.expectedMs ?? 0) - (verification.actualMs ?? 0)).toBeGreaterThan(5_000);
  }, 60_000);

  describe.skipIf(!hasLame)('MP3', () => {
    it('12 LAME CBR chapters with a gapless (Info) header verify and decode exactly to their total', async () => {
      const files = await chapters('lame', 12, 3.1, ['-c:a', 'libmp3lame', '-b:a', '64k'], 'mp3');
      const { result, decoded } = await merge(files, 'lame');

      expect(result.durationVerified).toBe(true);
      // No gaps added at the 11 boundaries
      expect(Math.abs(decoded - decodedTotal(files))).toBeLessThanOrEqual(150);
      const content = await probeAudioContent(path.join(dir, 'out', 'lame.m4b'));
      expect(content.gapMs).toBe(0);
    }, 240_000);

    it('VBR chapters without a Xing header (estimated format.duration) verify, with no audio lost', async () => {
      // Loud start, near-silent rest: ffprobe extrapolates format.duration from the first frames
      const files = await chapters('noxing', 3, 12, ['-c:a', 'libmp3lame', '-q:a', '2', '-write_xing', '0'], 'mp3', 3);
      const { result, outputPath, decoded } = await merge(files, 'noxing');

      expect(result.durationVerified).toBe(true);
      expect(Math.abs(decoded - decodedTotal(files))).toBeLessThanOrEqual(mergeToleranceMs(3));
      await expectMarkersMatch(outputPath, files);
    }, 180_000);

    it('a chapter read short during the merge (10 x 12 s, Xing CBR) is not verified, though the output ends at full length', async () => {
      const files = await chapters('short', 10, 12, ['-c:a', 'libmp3lame', '-b:a', '64k'], 'mp3');
      const victim = files[4];
      const backup = `${victim}.bak`;
      hooks.before = () => {
        // Measured whole; during the merge it delivers about 2 s less (window 1.5 s, 2% check 2.4 s)
        fs.copyFileSync(victim, backup);
        const bytes = fs.readFileSync(victim);
        fs.writeFileSync(victim, bytes.subarray(0, Math.round(bytes.length * 0.83)));
      };
      hooks.after = () => fs.renameSync(backup, victim);
      try {
        const { result, outputPath, decoded } = await merge(files, 'short');
        const content = await probeAudioContent(outputPath);

        expect(result.success).toBe(true);
        expect(result.durationVerified).toBe(false);
        // The loss is real (decoded), yet the timeline still ends at the full length
        expect(decodedTotal(files) - decoded).toBeGreaterThan(mergeToleranceMs(10));
        expect(Math.abs(content.endMs - decodedTotal(files))).toBeLessThan(mergeToleranceMs(10));
        expect(content.gapMs).toBeGreaterThan(0);
        expect(fs.statSync(victim).size).toBe(fs.statSync(files[3]).size);
      } finally {
        hooks.before = hooks.after = null;
        if (fs.existsSync(backup)) fs.renameSync(backup, victim);
      }
    }, 240_000);
  });
});
