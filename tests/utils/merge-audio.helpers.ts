/**
 * Component: Chapter Merge Verification Test Helpers (real ffmpeg/ffprobe)
 * Documentation: documentation/features/chapter-merging.md
 *
 * Generated chapters (pink noise), real merges, decoded lengths. Used by the
 * merge-verification integration tests; their vi.mock of child_process (merge
 * hooks) applies to these calls too.
 */

import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { expect } from 'vitest';
import { analyzeChapterFiles, mergeChapters } from '@/lib/utils/chapter-merger';
import { mergeToleranceMs } from '@/lib/utils/merge-verification';

/** Callbacks around the merge's ffmpeg run: before it starts (after the chapters were measured) and when it exits. */
export interface MergeHooks {
  before: null | (() => void);
  after: null | (() => void);
}

const execFileP = promisify(execFile);

function has(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export const available = has('ffmpeg') && has('ffprobe');
export const hasLame = available && execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes('libmp3lame');

export async function ffmpeg(args: string[]) {
  // One thread: these tests run beside the rest of the suite
  await execFileP('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', ...args]);
}

/** Pink noise (a realistic bitrate, unlike a pure tone), optionally loud only for its first seconds. */
export async function noise(file: string, seconds: number, codec: string[], loudSeconds = 0) {
  const af = loudSeconds > 0 ? ['-af', `volume='if(lt(t,${loudSeconds}),1,0.02)':eval=frame`] : [];
  await ffmpeg(['-f', 'lavfi', '-i', `anoisesrc=d=${seconds}:c=pink:a=0.4`, ...af, ...codec, file]);
}

/** Decoded length (ms): what a player actually gets. Cached per file and size (sources are re-read). */
const decodedCache = new Map<string, number>();
export function decodedMs(file: string): number {
  const key = `${file}:${fs.statSync(file).size}`;
  const cached = decodedCache.get(key);
  if (cached !== undefined) return cached;
  const ms = decodeMs(file);
  decodedCache.set(key, ms);
  return ms;
}

export function decodeMs(file: string): number {
  const pcm = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-threads', '1', '-i', file, '-f', 's16le', '-ac', '1', '-ar', '8000', '-'], { maxBuffer: 1 << 30 });
  return Math.round((pcm.length / 2 / 8000) * 1000);
}

export const decodedTotal = (files: string[]) => files.reduce((sum, f) => sum + decodedMs(f), 0);

export async function chapterStartsMs(file: string): Promise<number[]> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', file]);
  return (JSON.parse(stdout).chapters as { start_time: string }[]).map((c) => Math.round(parseFloat(c.start_time) * 1000));
}

/** Chapter markers start where the previous chapters' decoded audio ends. */
export async function expectMarkersMatch(output: string, files: string[]) {
  const starts = await chapterStartsMs(output);
  expect(starts).toHaveLength(files.length);
  let at = 0;
  for (let i = 0; i < files.length; i++) {
    expect(Math.abs(starts[i] - at)).toBeLessThanOrEqual(mergeToleranceMs(i + 1));
    at += decodedMs(files[i]);
  }
}

let dir = '';

/** A fresh work directory (with out/) for one test file; returns it. */
export function makeWorkDir(): string {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-merge-verify-')));
  fs.mkdirSync(path.join(dir, 'out'));
  return dir;
}

export function removeWorkDir() {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
}

export async function chapters(name: string, count: number, seconds: number, codec: string[], ext: string, loudSeconds = 0) {
  const files: string[] = [];
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  for (let i = 1; i <= count; i++) files.push(path.join(dir, name, `${String(i).padStart(3, '0')} - Chapter.${ext}`));
  // Four encodes at a time (each single-threaded)
  for (let i = 0; i < count; i += 4) await Promise.all(files.slice(i, i + 4).map((f) => noise(f, seconds, codec, loudSeconds)));
  return files;
}

/** Truncate a chapter to `fraction` of its bytes for the length of the merge's ffmpeg run (measured whole before it). */
export function shortDuringMerge(hooks: MergeHooks, file: string, fraction: number) {
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
export const AAC_22K = ['-ar', '22050', '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart'];

/** Merge for real and return the result plus the merged file's decoded length. */
export async function merge(files: string[], name: string) {
  const outputPath = path.join(dir, 'out', `${name}.m4b`);
  const result = await mergeChapters(await analyzeChapterFiles(files), { title: 'Book', author: 'Author', outputPath });
  return { result, outputPath, decoded: fs.existsSync(outputPath) ? decodedMs(outputPath) : 0 };
}
