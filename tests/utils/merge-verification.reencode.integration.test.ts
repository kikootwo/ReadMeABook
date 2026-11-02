/**
 * Component: Chapter Merge Source Verification Tests, re-encode (real ffmpeg/ffprobe)
 * Documentation: documentation/features/chapter-merging.md
 *
 * Real re-encoding merges (FLAC, ADTS .aac, MP3) of generated chapters, checked
 * against the DECODED output: complete merges verify, including chapters whose
 * container duration is an estimate (timestamps rebuilt from samples) and
 * mixed rates; a merge whose timeline does not match its audio, or that is over
 * 1 s short, fails (files organized individually). Skips when ffmpeg/ffprobe
 * are not on PATH (CI and the Docker image have them).
 */

import * as fs from 'fs';
import * as path from 'path';
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

import { available, chapters, decodedMs, decodeMs, decodedTotal, expectMarkersMatch, hasLame, makeWorkDir, merge, noise, removeWorkDir, shortDuringMerge } from './merge-audio.helpers';
import { analyzeChapterFiles } from '@/lib/utils/chapter-merger';
import { probeAudioContent } from '@/lib/utils/audio-content';
import { mergeToleranceMs } from '@/lib/utils/merge-verification';

let dir: string;

describe.skipIf(!available)('re-encoded merge verification on real audio (decoded)', () => {
  beforeAll(() => {
    dir = makeWorkDir();
  });

  afterAll(() => {
    hooks.before = hooks.after = null;
    removeWorkDir();
  });

  it('FLAC chapters (re-encoded) verify and decode to their total', async () => {
    const files = await chapters('flac', 3, 8, ['-c:a', 'flac'], 'flac');
    const { result, decoded } = await merge(files, 'flac');

    expect(result.durationVerified).toBe(true);
    expect(Math.abs(decoded - decodedTotal(files))).toBeLessThanOrEqual(mergeToleranceMs(3));
  }, 180_000);

  it('4 ADTS .aac chapters of 3 min (estimated container durations, re-encoded) verify', async () => {
    const files = await chapters('adts', 4, 180, ['-c:a', 'aac', '-b:a', '64k', '-f', 'adts'], 'aac');
    const estimates = await analyzeChapterFiles(files);
    const { result, outputPath, decoded } = await merge(files, 'adts');

    expect(estimates.some((c, i) => Math.abs(c.duration - decodedMs(files[i])) > 200)).toBe(true); // the premise
    expect(result.success).toBe(true);
    expect(result.durationVerified).toBe(true);
    expect(Math.abs(decoded - decodedTotal(files))).toBeLessThanOrEqual(100);
    expect((await probeAudioContent(outputPath)).gapMs).toBe(0);
  }, 300_000);

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

    const QUIET_INTRO = ['-af', "volume='if(lt(t,3),0.0001,1)':eval=frame"];
    const NO_XING_VBR = ['-c:a', 'libmp3lame', '-q:a', '2', '-write_xing', '0'];

    /** Chapters at different rates/channels (the merge keeps container timestamps for these). */
    async function mixedChapters(name: string, count: number, seconds: number, extra: string[] = []) {
      fs.mkdirSync(path.join(dir, name), { recursive: true });
      const files: string[] = [];
      for (let i = 0; i < count; i++) {
        const file = path.join(dir, name, `${String(i + 1).padStart(3, '0')} - Chapter.mp3`);
        await noise(file, seconds, ['-ar', String([44100, 22050, 24000][i % 3]), '-ac', String((i % 2) + 1), ...extra]);
        files.push(file);
      }
      return files;
    }

    it('VBR chapters without a Xing header and a quiet intro (estimates far off) verify: timestamps rebuilt from samples', async () => {
      // A near-silent start makes ffprobe overestimate each chapter; the concat demuxer would start the
      // next chapter there, leaving holes the chapter markers know nothing about
      const files = await chapters('quietintro', 3, 12, [...NO_XING_VBR, ...QUIET_INTRO], 'mp3');
      const estimates = await analyzeChapterFiles(files);
      expect(estimates[0].duration).toBeGreaterThan(15_000); // the premise: a far-off estimate
      const { result, outputPath, decoded } = await merge(files, 'quietintro');
      const content = await probeAudioContent(outputPath);

      expect(result.success).toBe(true);
      expect(result.durationVerified).toBe(true);
      expect(content.gapMs).toBe(0);
      expect(Math.abs(content.endMs - decodedTotal(files))).toBeLessThanOrEqual(100);
      expect(Math.abs(decoded - decodedTotal(files))).toBeLessThanOrEqual(100);
      await expectMarkersMatch(outputPath, files);
    }, 180_000);

    it('60 VBR chapters without a Xing header (6.3 s) verify', async () => {
      const files = await chapters('noxing60', 60, 6.3, ['-c:a', 'libmp3lame', '-q:a', '4', '-write_xing', '0'], 'mp3');
      const { result, decoded } = await merge(files, 'noxing60');

      expect(result.success).toBe(true);
      expect(result.durationVerified).toBe(true);
      expect(Math.abs(decoded - decodedTotal(files))).toBeLessThanOrEqual(100);
    }, 300_000);

    it('long VBR chapters without a Xing header (3 x 150 s) verify', async () => {
      const files = await chapters('noxinglong', 3, 150, ['-c:a', 'libmp3lame', '-q:a', '4', '-write_xing', '0'], 'mp3');
      const { result, decoded } = await merge(files, 'noxinglong');

      expect(result.success).toBe(true);
      expect(result.durationVerified).toBe(true);
      expect(Math.abs(decoded - decodedTotal(files))).toBeLessThanOrEqual(100);
    }, 300_000);

    it('chapters at mixed rates and channels (44.1/22.05/24 kHz, mono/stereo) verify', async () => {
      const files = await mixedChapters('mixed', 6, 4, ['-c:a', 'libmp3lame', '-b:a', '64k']);
      const { result, decoded } = await merge(files, 'mixed');

      expect(result.success).toBe(true);
      expect(result.durationVerified).toBe(true);
      expect(Math.abs(decoded - decodedTotal(files))).toBeLessThanOrEqual(150);
    }, 180_000);

    it('mixed-rate chapters with far-off estimates keep container timestamps, so the gaps fail the merge', async () => {
      const files = await mixedChapters('mixedquiet', 3, 12, [...NO_XING_VBR, ...QUIET_INTRO]);
      const { result, outputPath } = await merge(files, 'mixedquiet');

      expect(result.success).toBe(false); // organized individually
      expect(result.error).toContain('Merged file rejected: the merged timeline has');
      expect(fs.existsSync(outputPath)).toBe(false);
      for (const source of files) expect(fs.existsSync(source)).toBe(true);
    }, 180_000);

    it('a chapter read short mid-book (10 x 12 s, Xing CBR) fails the merge', async () => {
      const files = await chapters('short', 10, 12, ['-c:a', 'libmp3lame', '-b:a', '64k'], 'mp3');
      const output = path.join(dir, 'out', 'short.m4b');
      const kept = path.join(dir, 'short-output.m4b');
      // Measured whole; during the merge it delivers about 2 s less
      const size = fs.statSync(files[4]).size;
      const restore = shortDuringMerge(hooks, files[4], 0.83);
      const restoreSource = hooks.after!;
      hooks.after = () => {
        restoreSource();
        fs.copyFileSync(output, kept); // what ffmpeg wrote, before mergeChapters rejects it
      };
      try {
        const { result } = await merge(files, 'short');

        expect(result.success).toBe(false); // organized individually
        expect(result.error).toContain('shorter than the chapters');
        // The loss is real (decoded); with timestamps rebuilt from samples it leaves no gap
        expect(decodedTotal(files) - decodeMs(kept)).toBeGreaterThan(mergeToleranceMs(10));
        expect((await probeAudioContent(kept)).gapMs).toBe(0);
        for (const source of files) expect(fs.existsSync(source)).toBe(true);
      } finally {
        restore();
      }
      expect(fs.statSync(files[4]).size).toBe(size); // restored whole
    }, 240_000);
  });

});
