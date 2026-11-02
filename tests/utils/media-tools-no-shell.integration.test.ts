/**
 * Component: Media Tool Invocation Integration Tests (real ffmpeg/ffprobe)
 * Documentation: documentation/features/chapter-merging.md
 *
 * File names come from downloads and import folders, so they are untrusted.
 * These tests feed names containing shell metacharacters through the real
 * probe / scan / merge paths and assert (a) the tools see the exact path and
 * (b) nothing in the name is executed (sentinel files are never created).
 * `%RMAB_SHELL_PROBE%` makes a cmd.exe shell (Windows) visibly rewrite the path;
 * `$(...)` and backticks do the same under /bin/sh.
 *
 * Skips cleanly when ffmpeg/ffprobe are not on PATH (availability is checked
 * synchronously at module load so `it.skipIf` can see it).
 */

import { execFile, spawnSync } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeChapterFiles, mergeChapters, probeAudioFile } from '@/lib/utils/chapter-merger';
import { readAudioMetadata } from '@/lib/utils/bulk-import-scanner';

const execFileP = promisify(execFile);

function hasBinarySync(bin: string): boolean {
  try {
    return spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

const ffmpegAvailable = hasBinarySync('ffmpeg');
const ffprobeAvailable = hasBinarySync('ffprobe');
const skipReal = !(ffmpegAvailable && ffprobeAvailable);

const tag = Math.random().toString(36).slice(2, 10);
// A shell would run these relative to the test process's cwd.
const SENTINELS = [`rmab-shellprobe-${tag}-a`, `rmab-shellprobe-${tag}-b`];
// `"` is not a legal file name character on Windows.
const DQ = process.platform === 'win32' ? '' : ' "dq"';

/** Base name carrying every metacharacter class we care about. */
function hostileName(prefix: string, ext: string): string {
  return `${prefix} $(touch ${SENTINELS[0]}) \`touch ${SENTINELS[1]}\`${DQ} 'sq' %RMAB_SHELL_PROBE%${ext}`;
}

let workDir = '';

function sentinelsCreated(): string[] {
  return SENTINELS.filter((s) => existsSync(path.join(process.cwd(), s)) || existsSync(path.join(workDir, s)));
}

async function makeTone(fileName: string, album: string): Promise<string> {
  const out = path.join(workDir, fileName);
  await execFileP('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'anoisesrc=d=3:a=0.5:sample_rate=44100',
    '-c:a', 'aac', '-b:a', '192k',
    '-metadata', `album=${album}`,
    out,
  ]);
  return out;
}

async function readFormatTags(filePath: string): Promise<Record<string, string>> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', filePath]);
  return (JSON.parse(stdout) as { format?: { tags?: Record<string, string> } }).format?.tags ?? {};
}

async function countChapters(filePath: string): Promise<number> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', filePath]);
  return ((JSON.parse(stdout) as { chapters?: unknown[] }).chapters ?? []).length;
}

beforeAll(async () => {
  if (skipReal) {
    console.warn(
      `[media-tools-no-shell.integration] Skipping real-ffmpeg tests: ffmpeg=${ffmpegAvailable}, ffprobe=${ffprobeAvailable}`
    );
    return;
  }
  process.env.RMAB_SHELL_PROBE = 'expanded';
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-noshell-it-'));
}, 30_000);

afterAll(async () => {
  delete process.env.RMAB_SHELL_PROBE;
  for (const s of SENTINELS) {
    await fs.rm(path.join(process.cwd(), s), { force: true });
  }
  if (workDir) {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe('media tools run without a shell (real ffmpeg)', () => {
  it.skipIf(skipReal)('probeAudioFile reads a file whose name holds shell metacharacters', async () => {
    const file = await makeTone(hostileName('probe', '.m4a'), 'Probe Album');

    const probe = await probeAudioFile(file);

    expect(probe.duration).toBeGreaterThan(2500);
    expect(probe.duration).toBeLessThan(3500);
    expect(sentinelsCreated()).toEqual([]);
  }, 60_000);

  it.skipIf(skipReal)('bulk-import readAudioMetadata reads tags from a hostile file name', async () => {
    const file = await makeTone(hostileName('scan', '.m4a'), 'Hostile Album');

    const meta = await readAudioMetadata(file);

    expect(meta.title).toBe('Hostile Album');
    expect(sentinelsCreated()).toEqual([]);
  }, 60_000);

  it.skipIf(skipReal)('mergeChapters merges hostile file names and writes metadata verbatim', async () => {
    const files = [
      await makeTone(hostileName('ch 01', '.m4a'), 'Merge Album'),
      await makeTone(hostileName('ch 02', '.m4a'), 'Merge Album'),
    ];
    const outputPath = path.join(workDir, hostileName('merged', '.m4b'));
    const title = `My "Book" $HOME \`id\` 'q' %RMAB_SHELL_PROBE% \\path`;

    const chapters = await analyzeChapterFiles(files);
    const result = await mergeChapters(chapters, { title, author: `O'Brien "Jr"`, outputPath });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.chapterCount).toBe(2);
    expect(await countChapters(outputPath)).toBe(2);
    const tags = await readFormatTags(outputPath);
    expect(tags.title).toBe(title);
    expect(tags.album_artist).toBe(`O'Brien "Jr"`);
    expect(sentinelsCreated()).toEqual([]);
  }, 120_000);
});
