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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tagAudioFileMetadata } from '@/lib/utils/metadata-tagger';

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

  describe('description, genre and audiobook flags', () => {
    const DESCRIPTION = 'A heist on Luthadel.\n\nThe second paragraph — with "quotes".';
    const FLAT_DESCRIPTION = 'A heist on Luthadel. The second paragraph — with "quotes".';
    const GENRES = ['Science Fiction & Fantasy', 'Mystery, Thriller & Suspense'];
    const GENRE_TAG = 'Science Fiction & Fantasy; Mystery, Thriller & Suspense';

    it.skipIf(skipReal)(
      'm4a: desc, ldes, genre, stik and pgap are written and read back',
      async () => {
        const src = await makeFixture('.m4a');
        const result = await tagAudioFileMetadata(src, {
          title: 'Book',
          author: 'Author',
          description: DESCRIPTION,
          genres: GENRES,
        });
        expect(result.success).toBe(true);
        const tagged = result.taggedFilePath!;
        expect(await readTag(tagged, 'description')).toBe(FLAT_DESCRIPTION);
        expect(await readTag(tagged, 'synopsis')).toBe(FLAT_DESCRIPTION);
        expect(await readTag(tagged, 'genre')).toBe(GENRE_TAG);
        expect(await readTag(tagged, 'media_type')).toBe('2');
        expect(await readTag(tagged, 'gapless_playback')).toBe('1');
      },
      60_000
    );

    it.skipIf(skipReal)(
      'mp3: description and genre are written and read back',
      async () => {
        const src = await makeFixture('.mp3');
        const result = await tagAudioFileMetadata(src, {
          title: 'Book',
          author: 'Author',
          description: DESCRIPTION,
          genres: GENRES,
        });
        expect(result.success).toBe(true);
        expect(await readTag(result.taggedFilePath!, 'description')).toBe(FLAT_DESCRIPTION);
        expect(await readTag(result.taggedFilePath!, 'genre')).toBe(GENRE_TAG);
      },
      60_000
    );

    it.skipIf(skipReal)(
      'flac: description and genre are written and read back',
      async () => {
        const src = await makeFixture('.flac');
        const result = await tagAudioFileMetadata(src, {
          title: 'Book',
          author: 'Author',
          description: DESCRIPTION,
          genres: GENRES,
        });
        expect(result.success).toBe(true);
        // The Vorbis DESCRIPTION field is what ffprobe reports as `comment`
        expect(await readTag(result.taggedFilePath!, 'comment')).toBe(FLAT_DESCRIPTION);
        expect(await readTag(result.taggedFilePath!, 'genre')).toBe(GENRE_TAG);
      },
      60_000
    );
  });

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
