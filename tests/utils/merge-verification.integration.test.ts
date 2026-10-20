/**
 * Component: Chapter Merge Source Verification Tests (real ffmpeg/ffprobe)
 * Documentation: documentation/features/chapter-merging.md
 *
 * Real merges of generated chapters, checked against the DECODED output:
 * complete merges must verify (also 80 copied AAC chapters at 22.05 kHz, where
 * each boundary's priming reads as extra audio); merges that lost audio (a
 * chapter read short or missing during the merge, an output cut short) must
 * not, even when the output still ends at full length; a merge whose timeline
 * does not match its audio fails (files organized individually). Skips when
 * ffmpeg/ffprobe are not on PATH (CI and the Docker image have them).
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
  await execFileP('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', ...args]);
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
  const pcm = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-threads', '1', '-i', file, '-f', 's16le', '-ac', '1', '-ar', '8000', '-'], { maxBuffer: 1 << 30 });
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
  for (let i = 1; i <= count; i++) files.push(path.join(dir, name, `${String(i).padStart(3, '0')} - Chapter.${ext}`));
  // Four encodes at a time (each single-threaded)
  for (let i = 0; i < count; i += 4) await Promise.all(files.slice(i, i + 4).map((f) => noise(f, seconds, codec, loudSeconds)));
  return files;
}

/** Truncate a chapter to `fraction` of its bytes for the length of the merge's ffmpeg run (measured whole before it). */
function shortDuringMerge(file: string, fraction: number) {
  const backup = `${file}.bak`;
  hooks.before = () => {
    fs.copyFileSync(file, backup);
    const bytes = fs.readFileSync(file);
    fs.writeFileSync(file, bytes.subarray(0, Math.round(bytes.length * fraction)));
  };
  hooks.after = () => fs.renameSync(backup, file);
  return () => {
    hooks.before = hooks.after = null;
    if (fs.existsSync(backup)) fs.renameSync(backup, file);
  };
}

/** AAC-LC 22.05 kHz mono, moov first: a common audiobook chapter encoding. */
const AAC_22K = ['-ar', '22050', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart'];

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

    const verification = await verifyMergedFile(files, partial, 'copy');

    expect(verification.verified).toBe(false);
    expect((verification.expectedMs ?? 0) - (verification.actualMs ?? 0)).toBeGreaterThan(5_000);
  }, 60_000);

  it('40 short AAC chapters at 22.05 kHz (2.1 s, codec copy) verify', async () => {
    const files = await chapters('short22k', 40, 2.1, AAC_22K, 'm4a');
    const { result, decoded } = await merge(files, 'short22k');

    expect(result.success).toBe(true);
    expect(result.durationVerified).toBe(true);
    expect(decoded).toBeGreaterThanOrEqual(decodedTotal(files) - 100); // nothing lost
  }, 300_000);

  describe('80 AAC chapters at 22.05 kHz (codec copy)', () => {
    // 80 x 3 s: each later chapter's priming and trimmed last packet read as about 69 ms of
    // extra audio in the merged file, 5.5 s in all, more than 1 s + 50 ms per chapter (5 s)
    let files: string[];
    beforeAll(async () => {
      files = await chapters('aac80', 80, 3, AAC_22K, 'm4a');
    }, 600_000);

    it('a complete merge verifies; nothing lost; markers at the boundaries', async () => {
      const { result, outputPath, decoded } = await merge(files, 'aac80');

      expect(result.success).toBe(true);
      expect(result.durationVerified).toBe(true);
      expect(decoded).toBeGreaterThanOrEqual(decodedTotal(files) - 100);
      await expectMarkersMatch(outputPath, files);
    }, 300_000);

    it('the LAST chapter read short during the merge (25% of its bytes) is not verified; sources stay', async () => {
      const size = fs.statSync(files[79]).size;
      const restore = shortDuringMerge(files[79], 0.25);
      try {
        const { result, decoded } = await merge(files, 'aac80-short');

        expect(result.success).toBe(true);
        expect(result.durationVerified).toBe(false);
        // Audio really lost: against the complete merge (a copy also decodes each later chapter's
        // priming, so the merged file decodes longer than the chapters even when 2 s short)
        const complete = path.join(dir, 'out', 'aac80.m4b');
        if (!fs.existsSync(complete)) await merge(files, 'aac80');
        expect(decodedMs(complete) - decoded).toBeGreaterThan(1_500);
        for (const source of files) expect(fs.existsSync(source)).toBe(true);
      } finally {
        restore();
      }
      expect(fs.statSync(files[79]).size).toBe(size); // restored whole
    }, 300_000);

    it('a complete merge whose last 2.5 s were cut off after ffmpeg exited is not verified', async () => {
      const output = path.join(dir, 'out', 'aac80-cut.m4b');
      hooks.after = () => {
        const tmp = `${output}.cut.m4b`;
        execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', output, '-t', '237.5', '-c', 'copy', '-f', 'mp4', tmp]);
        fs.renameSync(tmp, output);
      };
      try {
        const { result } = await merge(files, 'aac80-cut');
        expect(result.success).toBe(true);
        expect(result.durationVerified).toBe(false);
      } finally {
        hooks.after = null;
      }
    }, 300_000);
  });

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

    it('VBR chapters without a Xing header and a quiet intro: timestamps offset by the estimate, so the merge fails', async () => {
      // A near-silent start makes ffprobe overestimate each chapter; the concat demuxer starts the
      // next chapter there, leaving holes the chapter markers know nothing about
      const files = await chapters('quietintro', 3, 12, ['-c:a', 'libmp3lame', '-q:a', '2', '-write_xing', '0', '-af', "volume='if(lt(t,3),0.0001,1)':eval=frame"], 'mp3');
      const estimates = await analyzeChapterFiles(files);
      expect(estimates[0].duration).toBeGreaterThan(15_000); // the premise: a far-off estimate
      const { result, outputPath } = await merge(files, 'quietintro');

      expect(result.success).toBe(false); // organized individually
      expect(result.error).toContain('Merged timeline does not match its audio');
      expect(result.error).toContain('of gaps');
      expect(fs.existsSync(outputPath)).toBe(false);
      for (const source of files) expect(fs.existsSync(source)).toBe(true);
    }, 180_000);

    it('a chapter read short mid-book (10 x 12 s, Xing CBR) fails the merge, though the output ends at full length', async () => {
      const files = await chapters('short', 10, 12, ['-c:a', 'libmp3lame', '-b:a', '64k'], 'mp3');
      const output = path.join(dir, 'out', 'short.m4b');
      const kept = path.join(dir, 'short-output.m4b');
      // Measured whole; during the merge it delivers about 2 s less
      const size = fs.statSync(files[4]).size;
      const restore = shortDuringMerge(files[4], 0.83);
      const restoreSource = hooks.after!;
      hooks.after = () => {
        restoreSource();
        fs.copyFileSync(output, kept); // what ffmpeg wrote, before mergeChapters rejects it
      };
      try {
        const { result } = await merge(files, 'short');
        const content = await probeAudioContent(kept);

        expect(result.success).toBe(false);
        expect(result.error).toContain('of gaps');
        // The loss is real (decoded), yet the timeline still ends at the full length
        expect(decodedTotal(files) - decodeMs(kept)).toBeGreaterThan(mergeToleranceMs(10));
        expect(Math.abs(content.endMs - decodedTotal(files))).toBeLessThan(mergeToleranceMs(10));
        expect(content.gapMs).toBeGreaterThan(0);
      } finally {
        restore();
      }
      expect(fs.statSync(files[4]).size).toBe(size); // restored whole
    }, 240_000);
  });
});
