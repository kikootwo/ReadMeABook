/**
 * Component: Metadata Tagging Integration Tests (real ffmpeg)
 * Documentation: documentation/phase3/file-organization.md
 *
 * Gated behind a runtime ffmpeg/ffprobe availability check. Skips cleanly
 * if either binary is missing. Verifies that tag values written via the
 * real argv-form spawn path are read back byte-for-byte by ffprobe — this
 * is the integration-layer guarantee that the quote-bug (#171) cannot recur.
 *
 * Note: availability check uses spawnSync at module load so `it.skipIf` can
 * see the result (test-registration is synchronous; beforeAll runs later).
 */

import { execFile, spawnSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addMp4FreeformTags, tagAudioFileMetadata } from '@/lib/utils/metadata-tagger';
import { testHooks } from '@/lib/utils/mp4-freeform-tags';
import { audioMd5, countFreeform, makeM4b, probe, topLevelTypes } from './mp4-tags.helpers';

const execFileP = promisify(execFile);

function hasBinarySync(bin: string): boolean {
  try {
    const result = spawnSync(bin, ['-version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

const ffmpegAvailable = hasBinarySync('ffmpeg');
const ffprobeAvailable = hasBinarySync('ffprobe');
const skipReal = !(ffmpegAvailable && ffprobeAvailable);

let workDir = '';

beforeAll(async () => {
  if (skipReal) {
    // eslint-disable-next-line no-console
    console.warn(
      `[metadata-tagger.integration] Skipping real-ffmpeg tests: ffmpeg=${ffmpegAvailable}, ffprobe=${ffprobeAvailable}`
    );
    return;
  }
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-tagger-it-'));
}, 30_000);

afterAll(async () => {
  if (workDir) {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

/** Create a small silent fixture audio file in the requested format. */
async function makeFixture(ext: '.m4a' | '.mp3' | '.flac'): Promise<string> {
  const out = path.join(workDir, `fixture-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  const codecArgs =
    ext === '.mp3'
      ? ['-c:a', 'libmp3lame', '-q:a', '9']
      : ext === '.flac'
        ? ['-c:a', 'flac']
        : ['-c:a', 'aac', '-b:a', '32k'];
  await execFileP('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=mono:sample_rate=22050',
    '-t', '1',
    ...codecArgs,
    out,
  ]);
  return out;
}

/** Read a single metadata tag back from a file via ffprobe. */
async function readTag(filePath: string, key: string): Promise<string | undefined> {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format_tags',
    '-of', 'json',
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as { format?: { tags?: Record<string, string> } };
  const tags = parsed.format?.tags ?? {};
  return tags[key] ?? tags[key.toLowerCase()] ?? tags[key.toUpperCase()];
}

describe('metadata-tagger integration (real ffmpeg)', () => {
  // Torture value covers the bug-class surface:
  //   embedded `"`, `'`, `$`, `` ` ``, `\`, em-dash.
  const TORTURE = `Test "Quoted" Book — Don't $hop \`now\` \\path`;

  it.skipIf(skipReal)(
    'm4a: round-trips a torture-value title byte-for-byte',
    async () => {
      const src = await makeFixture('.m4a');
      const result = await tagAudioFileMetadata(src, { title: TORTURE, author: 'Author' });
      expect(result.success).toBe(true);
      expect(result.taggedFilePath).toBeDefined();
      const readBack = await readTag(result.taggedFilePath!, 'title');
      expect(readBack).toBe(TORTURE);
    },
    60_000
  );

  it.skipIf(skipReal)(
    'mp3: round-trips a torture-value title byte-for-byte',
    async () => {
      const src = await makeFixture('.mp3');
      const result = await tagAudioFileMetadata(src, { title: TORTURE, author: 'Author' });
      expect(result.success).toBe(true);
      const readBack = await readTag(result.taggedFilePath!, 'title');
      expect(readBack).toBe(TORTURE);
    },
    60_000
  );

  it.skipIf(skipReal)(
    'flac: round-trips a torture-value title byte-for-byte',
    async () => {
      const src = await makeFixture('.flac');
      const result = await tagAudioFileMetadata(src, { title: TORTURE, author: 'Author' });
      expect(result.success).toBe(true);
      const readBack = await readTag(result.taggedFilePath!, 'title');
      expect(readBack).toBe(TORTURE);
    },
    60_000
  );

  it.skipIf(skipReal)(
    'm4a: author does NOT inherit a stray leading `"` when title contains `"`',
    async () => {
      // The exact #171 symptom: a `"` in one field used to leak as a leading `"`
      // on an adjacent field after shell tokenization. Verify both are clean.
      const src = await makeFixture('.m4a');
      const result = await tagAudioFileMetadata(src, {
        title: 'Has "embedded" quotes',
        author: 'Alexandre Dumas',
      });
      expect(result.success).toBe(true);
      const readAuthor = await readTag(result.taggedFilePath!, 'album_artist');
      expect(readAuthor).toBe('Alexandre Dumas');
      expect(readAuthor?.startsWith('"')).toBe(false);
    },
    60_000
  );
});

describe.skipIf(skipReal)('m4b ASIN and layout (real ffmpeg)', () => {
  afterEach(() => {
    testHooks.afterPlan = undefined;
  });

  /** The organizer's order: the tagging pass, then the one ASIN step on the tagged copy. */
  async function tagWithAsin(src: string, asin: string) {
    const result = await tagAudioFileMetadata(src, { title: 'Book', author: 'Author', asin });
    expect(result.success).toBe(true);
    const step = await addMp4FreeformTags(result.taggedFilePath!, path.extname(src), { asin });
    return { tagged: result.taggedFilePath!, step };
  }

  it('the ASIN is written: ffprobe (the reader Audiobookshelf uses) reads format tag ASIN', async () => {
    const src = await makeM4b(workDir, 'asin-src.m4b', { faststart: false });
    const { tagged, step } = await tagWithAsin(src, 'B0TESTASIN');
    expect(step).toEqual({ written: true });
    const { tags } = await probe(tagged);
    expect(tags.ASIN).toBe('B0TESTASIN');
    expect(tags.title).toBe('Book');
    expect(countFreeform(tagged, 'ASIN')).toBe(1);
  }, 60_000);

  it.each([
    ['with the ASIN step', 'B0TESTASIN'],
    ['without an ASIN (ffmpeg +faststart only)', undefined],
  ])('the tagged copy is moov first (faststart) %s, cover and text-track chapters intact', async (_name, asin) => {
    const src = await makeM4b(workDir, `layout-${asin ?? 'none'}.m4b`, { faststart: false });
    const before = await probe(src);
    const md5 = await audioMd5(src);
    const tagged = asin
      ? (await tagWithAsin(src, asin)).tagged
      : (await tagAudioFileMetadata(src, { title: 'Book', author: 'Author' })).taggedFilePath!;
    expect(topLevelTypes(tagged).slice(0, 2)).toEqual(['ftyp', 'moov']);
    const after = await probe(tagged);
    expect(after.streams).toEqual(before.streams);
    // ffmpeg's re-mux may change the chapter time base (9.0.2 does): compare times and titles
    const marks = (p: typeof before) => p.chapters.map((c) => [c.start_time, c.end_time, c.tags?.title]);
    expect(marks(after)).toEqual(marks(before));
    expect(marks(after).map((m) => m[2])).toEqual(['Chapter One', 'Chapter Two']);
    expect(await audioMd5(tagged)).toBe(md5);
  }, 60_000);

  it('a refused ASIN step still leaves the tagged copy moov first (ffmpeg +faststart), unchanged', async () => {
    const src = await makeM4b(workDir, 'refused.m4b', { faststart: false });
    const result = await tagAudioFileMetadata(src, { title: 'Book', author: 'Author', asin: 'B0TESTASIN' });
    const original = await fs.readFile(result.taggedFilePath!);
    testHooks.afterPlan = () => {
      throw new Error('refused for the test');
    };
    const step = await addMp4FreeformTags(result.taggedFilePath!, '.m4b', { asin: 'B0TESTASIN' });
    expect(step).toEqual({ written: false, warning: 'ASIN tag not written (refused for the test)' });
    expect((await fs.readFile(result.taggedFilePath!)).equals(original)).toBe(true);
    expect(topLevelTypes(result.taggedFilePath!).slice(0, 2)).toEqual(['ftyp', 'moov']);
  }, 60_000);

  it('re-tagging a tagged copy that already holds an ASIN: exactly one ASIN item (the new one), moov first', async () => {
    const src = await makeM4b(workDir, 'retag.m4b', { faststart: true });
    const first = await tagWithAsin(src, 'B0FIRST000');
    expect(countFreeform(first.tagged, 'ASIN')).toBe(1);
    const tagged = path.join(workDir, 'retag-tagged.m4b');
    await fs.rename(first.tagged, tagged);
    const { tagged: again } = await tagWithAsin(tagged, 'B0TESTASIN');
    expect(countFreeform(again, 'ASIN')).toBe(1);
    expect((await probe(again)).tags.ASIN).toBe('B0TESTASIN');
    expect(topLevelTypes(again).slice(0, 2)).toEqual(['ftyp', 'moov']);
  }, 60_000);
});
