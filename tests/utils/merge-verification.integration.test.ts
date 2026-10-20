/**
 * Component: Chapter Merge Source Verification Tests, codec copy (real ffmpeg/ffprobe)
 * Documentation: documentation/features/chapter-merging.md
 *
 * Real merges of generated AAC chapters, checked against the DECODED output:
 * complete copies verify (also 80 chapters at 22.05 kHz, where each boundary's
 * priming reads as extra audio); copies that lost audio (a chapter read short
 * or missing during the merge, an output cut short) must not. Skips when
 * ffmpeg/ffprobe are not on PATH (CI and the Docker image have them).
 */

import { execFileSync } from 'child_process';
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

import { AAC_22K, available, chapters, decodedMs, decodedTotal, expectMarkersMatch, ffmpeg, makeWorkDir, merge, removeWorkDir, shortDuringMerge } from './merge-audio.helpers';
import { mergeToleranceMs, verifyMergedFile } from '@/lib/utils/merge-verification';

let dir: string;

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
    dir = makeWorkDir();
  });

  afterAll(() => {
    hooks.before = hooks.after = null;
    removeWorkDir();
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

  it('a merge whose output was cut short after ffmpeg exited is not verified; sources stay', async () => {
    const files = await chapters('cut', 3, 30, ['-c:a', 'aac', '-b:a', '96k'], 'm4a');
    hooks.after = () => {
      const output = path.join(dir, 'out', 'cut.m4b');
      const tmp = `${output}.cut.m4b`;
      // 1.5 s of 90 s lost: inside the 2% merge check (1.8 s), outside 1.15 s
      execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', output, '-t', '88.5', '-c', 'copy', '-map_chapters', '-1', '-f', 'mp4', tmp]);
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
      const restore = shortDuringMerge(hooks, files[79], 0.25);
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

});
