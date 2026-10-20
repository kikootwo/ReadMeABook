/**
 * Component: Chapter Merge Source Verification Tests (real ffmpeg/ffprobe)
 * Documentation: documentation/features/chapter-merging.md
 *
 * Real merges of generated chapters must verify; a merge that lost audio
 * (output cut short after ffmpeg exits, a missing chapter) must not, even when
 * the old percentage window would have let it through. Skips when
 * ffmpeg/ffprobe are not on PATH (CI and the Docker image have them).
 */

import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Real child_process; a test can ask for the merged output to be cut short
// once the merge's ffmpeg exits (before mergeChapters inspects it), which is
// what an input read error mid-merge leaves behind (no -xerror: exit 0).
const cut = vi.hoisted(() => ({ toSeconds: 0 }));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const spawn = ((cmd: string, args: readonly string[], ...rest: unknown[]) => {
    const child = (actual.spawn as (...a: unknown[]) => import('child_process').ChildProcess)(cmd, args, ...rest);
    if (cmd === 'ffmpeg' && cut.toSeconds > 0 && args.includes('concat')) {
      const output = args[args.length - 1];
      child.on('close', () => {
        const tmp = `${output}.cut.m4b`;
        actual.execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', output, '-t', String(cut.toSeconds), '-c', 'copy', '-map_chapters', '-1', '-f', 'mp4', tmp]);
        fs.renameSync(tmp, output);
      });
    }
    return child;
  }) as typeof actual.spawn;
  return { ...actual, spawn };
});

import { analyzeChapterFiles, mergeChapters, type ChapterFile } from '@/lib/utils/chapter-merger';
import { probeStreamDurationMs } from '@/lib/utils/audio-duration';
import { mergeToleranceMs, verifyMergedDuration } from '@/lib/utils/merge-verification';

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
  await execFileP('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

/** Pink noise (a realistic bitrate, unlike a pure tone), optionally loud only for its first seconds. */
async function noise(file: string, seconds: number, codec: string[], loudSeconds = 0) {
  const af = loudSeconds > 0 ? ['-af', `volume='if(lt(t,${loudSeconds}),1,0.02)':eval=frame`] : [];
  await ffmpeg(['-f', 'lavfi', '-i', `anoisesrc=d=${seconds}:c=pink:a=0.4`, ...af, ...codec, file]);
}

async function formatDurationMs(file: string): Promise<number> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Math.round(parseFloat(stdout) * 1000);
}

async function chapterStartsMs(file: string): Promise<number[]> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', file]);
  return (JSON.parse(stdout).chapters as { start_time: string }[]).map((c) => Math.round(parseFloat(c.start_time) * 1000));
}

/** Chapter markers start where the previous chapters' audio ends (packet-accurate). */
async function expectMarkersMatch(output: string, chapters: ChapterFile[]) {
  const starts = await chapterStartsMs(output);
  expect(starts).toHaveLength(chapters.length);
  let at = 0;
  for (let i = 0; i < chapters.length; i++) {
    expect(Math.abs(starts[i] - at)).toBeLessThanOrEqual(mergeToleranceMs(i + 1));
    at += await probeStreamDurationMs(chapters[i].path);
  }
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

describe.skipIf(!available)('merge verification on real audio', () => {
  let dir: string;
  const m4a: string[] = [];
  const m4b: string[] = [];

  beforeAll(async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-merge-verify-')));
    fs.mkdirSync(path.join(dir, 'out'));
    // 3 x 30 s: the 2% merge check allows 1.8 s, the source check 1.15 s
    for (let i = 1; i <= 3; i++) {
      const file = path.join(dir, `0${i} - Chapter.m4a`);
      await noise(file, 30, ['-c:a', 'aac', '-b:a', '96k']);
      m4a.push(file);
      const book = path.join(dir, `0${i} - Part.m4b`);
      await ffmpeg(['-i', file, '-c', 'copy', '-f', 'mp4', book]);
      m4b.push(book);
    }
  }, 120_000);

  afterAll(() => {
    cut.toSeconds = 0;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('an exact codec-copy merge of AAC chapters is verified, with markers at the chapter boundaries', async () => {
    const chapters = await analyzeChapterFiles(m4a);
    const outputPath = path.join(dir, 'out', 'aac.m4b');
    const result = await mergeChapters(chapters, { title: 'Book', author: 'Author', outputPath });

    expect(result.success).toBe(true);
    expect(result.durationVerified).toBe(true);
    await expectMarkersMatch(outputPath, chapters);
  }, 120_000);

  it('a merge of .m4b parts is verified, with one marker per part', async () => {
    const chapters = await analyzeChapterFiles(m4b);
    const outputPath = path.join(dir, 'out', 'parts.m4b');
    const result = await mergeChapters(chapters, { title: 'Book', author: 'Author', outputPath });

    expect(result.success).toBe(true);
    expect(result.durationVerified).toBe(true);
    await expectMarkersMatch(outputPath, chapters);
  }, 120_000);

  it('a merge whose output was cut short passes the 2% merge check but is not verified; sources stay', async () => {
    cut.toSeconds = 88.5; // 1.5 s of 90 s lost: inside 2% (1.8 s), outside 1.15 s
    try {
      const chapters = await analyzeChapterFiles(m4a);
      const outputPath = path.join(dir, 'out', 'cut.m4b');
      const result = await mergeChapters(chapters, { title: 'Book', author: 'Author', outputPath });

      expect(result.success).toBe(true);
      expect(result.durationVerified).toBe(false);
      const lost = (result.totalDuration ?? 0) - (await probeStreamDurationMs(outputPath));
      expect(lost).toBeGreaterThan(mergeToleranceMs(3));
      for (const source of m4a) expect(fs.existsSync(source)).toBe(true);
    } finally {
      cut.toSeconds = 0;
    }
  }, 120_000);

  it('a merged file missing its last chapter is not verified', async () => {
    const partial = path.join(dir, 'out', 'missing-chapter.m4b');
    const list = path.join(dir, 'two.txt');
    fs.writeFileSync(list, m4a.slice(0, 2).map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-f', 'mp4', partial]);

    const result = await verifyMergedDuration(m4a, partial);

    expect(result.verified).toBe(false);
    expect((result.expectedMs ?? 0) - (result.actualMs ?? 0)).toBeGreaterThan(25_000);
  }, 60_000);

  describe.skipIf(!hasLame)('VBR MP3 without a Xing header', () => {
    const mp3: string[] = [];

    beforeAll(async () => {
      // Loud start, near-silent rest: ffprobe extrapolates format.duration from the first frames' bitrate
      for (let i = 1; i <= 3; i++) {
        const file = path.join(dir, `0${i} - Track.mp3`);
        await noise(file, 20, ['-c:a', 'libmp3lame', '-q:a', '2', '-write_xing', '0'], 3);
        mp3.push(file);
      }
    }, 120_000);

    it('format.duration is off by more than the source window, so packets are what the merge uses', async () => {
      let estimated = 0;
      let measured = 0;
      for (const file of mp3) {
        estimated += await formatDurationMs(file);
        measured += await probeStreamDurationMs(file);
      }
      expect(Math.abs(estimated - measured)).toBeGreaterThan(mergeToleranceMs(3));
    });

    it('a re-encoding merge is verified, with markers at the real chapter boundaries', async () => {
      const chapters = await analyzeChapterFiles(mp3);
      const outputPath = path.join(dir, 'out', 'mp3.m4b');
      const result = await mergeChapters(chapters, { title: 'Book', author: 'Author', outputPath });

      expect(result.success).toBe(true);
      expect(result.durationVerified).toBe(true);
      await expectMarkersMatch(outputPath, chapters);
    }, 180_000);
  });
});
