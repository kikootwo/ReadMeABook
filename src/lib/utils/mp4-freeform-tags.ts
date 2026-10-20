/**
 * Component: MP4 Freeform Tags (adds iTunes '----' tags, e.g. ASIN, after ffmpeg)
 * Documentation: documentation/phase3/file-organization.md
 *
 * ffmpeg's mp4 muxer writes only the iTunes atoms it knows, so custom tags
 * (ASIN, and later PUBLISHER/SUBTITLE/LANGUAGE) never reach an .m4b through
 * `-metadata`. This writes a NEW file, moov first (faststart), with the tags
 * added, verifies it, then renames it over RMAB's own fresh ffmpeg output.
 * On any refusal or failure the ffmpeg output is left untouched (a valid file
 * without the tags) and the caller logs a warning.
 */

import { execFile } from 'child_process';
import fs from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { partialNameFor, syncDirectory } from './copy-file';
import { removeStalePartials } from './organize-copy';
import {
  FreeformTag,
  Mp4UnsupportedError,
  RewritePlan,
  parseBoxHeader,
  planFreeformRewrite,
  shiftedOffset,
  validateTags,
  verifyRewrittenMoov,
  type BoxRef,
} from './mp4-boxes';

export type { FreeformTag } from './mp4-boxes';

const execFileP = promisify(execFile);

const MAX_MOOV_BYTES = 128 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 1000;
const COPY_CHUNK = 1024 * 1024;
const AUDIO_CHUNKS_COMPARED = 64;
const AUDIO_COMPARE_BYTES = 4096;
const OTHER_COMPARE_LIMIT = 1024 * 1024;

/** Test-only fault injection (plain holder so vi.mock resets cannot clear it). */
export const testHooks: { afterPlan?: (plan: RewritePlan) => void; afterWrite?: (outputPath: string) => void } = {};

async function readExactly(fh: FileHandle, length: number, position: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await fh.read(buf, done, length - done, position + done);
    if (bytesRead === 0) throw new Mp4UnsupportedError(`unexpected end of file at ${position + done}`);
    done += bytesRead;
  }
  return buf;
}

/** Write all of buf[start, end) at `position` (a positional write may be short). */
async function writeAll(fh: FileHandle, buf: Buffer, position: number, start = 0, end = buf.length): Promise<void> {
  let done = start;
  while (done < end) {
    const { bytesWritten } = await fh.write(buf, done, end - done, position + (done - start));
    if (bytesWritten === 0) throw new Error('write made no progress');
    done += bytesWritten;
  }
}

/** Top-level boxes of an open file (they must cover it exactly). */
async function scanTopLevel(fh: FileHandle, fileSize: number): Promise<BoxRef[]> {
  const boxes: BoxRef[] = [];
  let pos = 0;
  while (pos < fileSize) {
    if (boxes.length >= MAX_TOP_LEVEL_BOXES) throw new Mp4UnsupportedError('too many top-level boxes');
    const header = await readExactly(fh, Math.min(16, fileSize - pos), pos);
    const box = parseBoxHeader(header, pos, fileSize);
    boxes.push(box);
    pos += box.size;
  }
  return boxes;
}

async function readMoov(fh: FileHandle, top: BoxRef[]): Promise<Buffer> {
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new Mp4UnsupportedError('no moov box');
  if (moov.size > MAX_MOOV_BYTES) throw new Mp4UnsupportedError(`moov box is too large (${moov.size} bytes)`);
  return readExactly(fh, moov.size, moov.start);
}

async function copyRange(src: FileHandle, dst: FileHandle, start: number, end: number, dstStart: number): Promise<void> {
  const buf = Buffer.alloc(Math.min(COPY_CHUNK, Math.max(end - start, 1)));
  let pos = start;
  while (pos < end) {
    const { bytesRead } = await src.read(buf, 0, Math.min(buf.length, end - pos), pos);
    if (bytesRead === 0) throw new Mp4UnsupportedError('input ended while copying');
    await writeAll(dst, buf, dstStart + (pos - start), 0, bytesRead);
    pos += bytesRead;
  }
}

/** The bytes at `position` equal `expected`, read back a chunk at a time. */
async function bytesMatch(fh: FileHandle, expected: Buffer, position: number): Promise<boolean> {
  for (let at = 0; at < expected.length; at += COPY_CHUNK) {
    const length = Math.min(COPY_CHUNK, expected.length - at);
    if (!(await readExactly(fh, length, position + at)).equals(expected.subarray(at, at + length))) return false;
  }
  return true;
}

/** Chunk indexes to compare: every chunk of non-audio tracks, a spread of audio chunks. */
function sampleChunks(count: number, audio: boolean): number[] {
  if (!audio || count <= AUDIO_CHUNKS_COMPARED) return Array.from({ length: count }, (_, i) => i);
  const picks = new Set<number>([0, count - 1]);
  for (let k = 1; k < AUDIO_CHUNKS_COMPARED - 1; k++) picks.add(Math.floor((k * (count - 1)) / (AUDIO_CHUNKS_COMPARED - 1)));
  return [...picks].sort((a, b) => a - b);
}

/** The output's chunks hold the same bytes as the input's at the old offsets. */
async function compareChunks(input: FileHandle, output: FileHandle, plan: RewritePlan): Promise<void> {
  for (const [ti, track] of plan.oldTracks.entries()) {
    const audio = track.handler === 'soun';
    for (const i of sampleChunks(track.offsets.length, audio)) {
      const length = Math.min(track.chunkSizes[i], audio ? AUDIO_COMPARE_BYTES : OTHER_COMPARE_LIMIT);
      if (length === 0) continue;
      const before = await readExactly(input, length, track.offsets[i]);
      const after = await readExactly(output, length, shiftedOffset(plan.mdatShifts, track.offsets[i]));
      if (!before.equals(after)) throw new Mp4UnsupportedError(`track ${ti + 1} chunk ${i + 1} moved to the wrong place`);
    }
  }
}

/** ffprobe (the reader Audiobookshelf uses) sees every tag with its value. */
async function probeTags(filePath: string, tags: FreeformTag[]): Promise<void> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', filePath], {
    timeout: 60_000,
  });
  const found = (JSON.parse(stdout) as { format?: { tags?: Record<string, string> } }).format?.tags ?? {};
  for (const tag of tags) {
    const key = Object.keys(found).find((k) => k.toLowerCase() === tag.name.toLowerCase());
    if (!key || found[key] !== tag.value) throw new Mp4UnsupportedError(`ffprobe does not read back ${tag.name}`);
  }
}

/** Check the written file: layout, moov bytes (verified before the write), chunk placement, ffprobe read-back. */
async function verifyOutput(input: FileHandle, outputPath: string, plan: RewritePlan, tags: FreeformTag[]): Promise<void> {
  const out = await fs.open(outputPath, 'r');
  try {
    const size = (await out.stat()).size;
    if (size !== plan.outputSize) throw new Mp4UnsupportedError(`output is ${size} bytes, expected ${plan.outputSize}`);
    const top = await scanTopLevel(out, size);
    const expected = [plan.ftyp.size, plan.newMoov.length, ...plan.segments.map((s) => s.end - s.start)];
    if (top.length !== expected.length || top.some((b, i) => b.size !== expected[i]) || top[1].type !== 'moov') {
      throw new Mp4UnsupportedError('output layout does not match the plan');
    }
    if (!(await bytesMatch(out, plan.newMoov, top[1].start))) throw new Mp4UnsupportedError('written moov differs from the plan');
    await compareChunks(input, out, plan);
  } finally {
    await out.close();
  }
  await probeTags(outputPath, tags);
}

/**
 * Write `outputPath` (must not exist) as `inputPath` with `tags` added and moov
 * first. Throws Mp4UnsupportedError (or an I/O error) and removes the output
 * on any failure after creating it; `inputPath` is only ever read.
 * Peak memory: about 2x the moov while planning, then 1x (moov <= 128 MiB).
 */
export async function writeFreeformTaggedCopy(inputPath: string, outputPath: string, tags: FreeformTag[]): Promise<void> {
  validateTags(tags);
  if (path.resolve(inputPath) === path.resolve(outputPath)) throw new Error('Output path must differ from the input path');

  const input = await fs.open(inputPath, 'r');
  let output: FileHandle | undefined;
  let created = false;
  try {
    const inputSize = (await input.stat()).size;
    const top = await scanTopLevel(input, inputSize);
    const plan = planFreeformRewrite(top, await readMoov(input, top), tags); // the read moov is scratch, dropped here
    testHooks.afterPlan?.(plan);
    verifyRewrittenMoov(plan, plan.newMoov, tags); // before anything is written

    output = await fs.open(outputPath, 'wx');
    created = true;
    await copyRange(input, output, plan.ftyp.start, plan.ftyp.start + plan.ftyp.size, 0);
    await writeAll(output, plan.newMoov, plan.ftyp.size);
    for (const segment of plan.segments) await copyRange(input, output, segment.start, segment.end, segment.newStart);
    await output.sync();
    await output.close();
    output = undefined;
    testHooks.afterWrite?.(outputPath);

    await verifyOutput(input, outputPath, plan, tags);
  } catch (error) {
    await output?.close().catch(() => undefined);
    if (created) await fs.unlink(outputPath).catch(() => undefined);
    throw error;
  } finally {
    await input.close();
  }
}

export interface FreeformTagResult {
  written: boolean;
  /** Why the tags were not written (the file is unchanged). */
  warning?: string;
}

/**
 * Add `tags` to `filePath`, an MP4 RMAB's own ffmpeg run just wrote: a tagged
 * copy (hidden `.rmab-partial-*.part` sibling, swept like other partials)
 * replaces it only after it verifies. Never throws.
 */
export async function addFreeformTags(filePath: string, tags: FreeformTag[]): Promise<FreeformTagResult> {
  if (tags.length === 0) return { written: false };
  const failed = (error: unknown): FreeformTagResult => ({
    written: false,
    warning: `${tags.map((t) => t.name).join(', ')} tag not written (${error instanceof Error ? error.message : String(error)})`,
  });
  const dir = path.dirname(filePath);
  await removeStalePartials(dir, path.basename(filePath));
  const tempPath = path.join(dir, partialNameFor(path.basename(filePath)));
  try {
    await writeFreeformTaggedCopy(filePath, tempPath, tags); // removes its own output on failure
  } catch (error) {
    return failed(error);
  }
  try {
    await fs.rename(tempPath, filePath); // every handle is closed, so this also works on Windows
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined); // ours: created and verified above
    return failed(error);
  }
  await syncDirectory(dir).catch(() => undefined); // durability only: the data is already fsynced
  return { written: true };
}
