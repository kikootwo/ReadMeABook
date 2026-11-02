/**
 * Component: Metadata Tagging Utility Tests
 * Documentation: documentation/phase3/file-organization.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addMp4FreeformTags,
  buildMp4FreeformTags,
  checkFfmpegAvailable,
  ffmpegRemuxTimeoutMs,
  tagAudioFileMetadata,
  tagMultipleFiles,
} from '@/lib/utils/metadata-tagger';
import { MAX_DESCRIPTION_BYTES } from '@/lib/utils/metadata-text';

const execFileMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  stat: vi.fn(async () => ({ size: 1024 })), // the size scales the ffmpeg timeout
  unlink: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('fs/promises', () => ({
  default: fsMock,
  ...fsMock,
}));

// The freeform-tag post-step (real-file behaviour: mp4-freeform-tags tests). Plain holder: survives mock resets.
const freeform = vi.hoisted(() => ({
  calls: [] as Array<[string, Array<{ name: string; value: string }>]>,
  result: { written: true } as { written: boolean; warning?: string },
}));
vi.mock('@/lib/utils/mp4-freeform-tags', () => ({
  addFreeformTags: async (file: string, tags: Array<{ name: string; value: string }>) => {
    freeform.calls.push([file, tags]);
    return tags.length ? freeform.result : { written: false };
  },
}));

const hasFreeformArg = (argv: string[]) => argv.some((a) => a.startsWith('----:'));

function mockExecFileSuccess(stdout = 'ok') {
  execFileMock.mockImplementation((file: string, args: string[], options: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    cb(null, stdout, '');
  });
}

function mockExecFileFailure(message = 'ffmpeg error') {
  execFileMock.mockImplementation((file: string, args: string[], options: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    cb(new Error(message), '', '');
  });
}

function lastCallArgv(): string[] {
  const call = execFileMock.mock.calls.at(-1);
  if (!call) throw new Error('execFile was not called');
  return call[1] as string[];
}

function lastCallCommand(): string {
  const call = execFileMock.mock.calls.at(-1);
  if (!call) throw new Error('execFile was not called');
  return call[0] as string;
}

/**
 * Assert that argv contains the adjacent pair `['-metadata', '${key}=${value}']`.
 * This is the regression-catching assertion — it verifies the metadata payload
 * is a single argv element with no embedded shell quoting.
 */
function expectMetadataArg(argv: string[], key: string, value: string): void {
  const expectedPayload = `${key}=${value}`;
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '-metadata' && argv[i + 1] === expectedPayload) {
      return;
    }
  }
  throw new Error(
    `Expected argv to contain ['-metadata', '${expectedPayload}'] as adjacent elements.\nArgv: ${JSON.stringify(argv)}`
  );
}

describe('metadata tagger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    freeform.calls = [];
    freeform.result = { written: true };
  });

  it('returns an error for unsupported file formats', async () => {
    fsMock.access.mockResolvedValue(undefined);

    const result = await tagAudioFileMetadata('/tmp/book.wav', {
      title: 'Book',
      author: 'Author',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported file format');
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('tags an m4b file with metadata using argv form', async () => {
    fsMock.access.mockResolvedValue(undefined);
    mockExecFileSuccess('done');

    const result = await tagAudioFileMetadata('/tmp/book.m4b', {
      title: 'Book',
      author: 'Author',
      narrator: 'Narrator',
      year: 2020,
      asin: 'ASIN123',
    });

    expect(result.success).toBe(true);
    expect(result.taggedFilePath).toBe('/tmp/book.m4b.tmp');

    expect(lastCallCommand()).toBe('ffmpeg');

    const argv = lastCallArgv();
    expectMetadataArg(argv, 'title', 'Book');
    expectMetadataArg(argv, 'album', 'Book');
    expectMetadataArg(argv, 'album_artist', 'Author');
    expectMetadataArg(argv, 'artist', 'Author');
    expectMetadataArg(argv, 'composer', 'Narrator');
    expectMetadataArg(argv, 'date', '2020');
    // ffmpeg drops freeform keys: the organizer adds the ASIN later (addMp4FreeformTags)
    expect(hasFreeformArg(argv)).toBe(false);
    expect(argv[argv.indexOf('-movflags') + 1]).toBe('+faststart');
    expect(freeform.calls).toEqual([]);

    expect(argv).toContain('/tmp/book.m4b');
    expect(argv).toContain('/tmp/book.m4b.tmp');

    const fIdx = argv.indexOf('-f');
    expect(fIdx).toBeGreaterThanOrEqual(0);
    expect(argv[fIdx + 1]).toBe('mp4');
  });

  it.each(['/tmp/book.m4b', '/tmp/book.mp3', '/tmp/book.flac'])(
    'does not use -xerror when tagging %s (codec copy would turn benign timestamp warnings into lost tags)',
    async (file) => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata(file, { title: 'Book', author: 'Author' });

      expect(lastCallArgv()).not.toContain('-xerror');
    }
  );

  it('tags an mp3 file with mp3 output format', async () => {
    fsMock.access.mockResolvedValue(undefined);
    mockExecFileSuccess('done');

    await tagAudioFileMetadata('/tmp/book.mp3', {
      title: 'Book',
      author: 'Author',
      asin: 'ASIN999',
    });

    const argv = lastCallArgv();
    expectMetadataArg(argv, 'title', 'Book');
    expectMetadataArg(argv, 'ASIN', 'ASIN999');
    const fIdx = argv.indexOf('-f');
    expect(argv[fIdx + 1]).toBe('mp3');
  });

  it('tags a flac file with flac output format', async () => {
    fsMock.access.mockResolvedValue(undefined);
    mockExecFileSuccess('done');

    await tagAudioFileMetadata('/tmp/book.flac', {
      title: 'Book',
      author: 'Author',
    });

    const argv = lastCallArgv();
    expectMetadataArg(argv, 'title', 'Book');
    expectMetadataArg(argv, 'albumartist', 'Author');
    const fIdx = argv.indexOf('-f');
    expect(argv[fIdx + 1]).toBe('flac');
  });

  it('cleans up temp files and returns errors when ffmpeg fails', async () => {
    fsMock.access.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);
    mockExecFileFailure('exec failed');

    const result = await tagAudioFileMetadata('/tmp/book.mp3', {
      title: 'Book',
      author: 'Author',
      asin: 'ASIN123',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('ffmpeg failed');
    expect(fsMock.unlink).toHaveBeenCalledWith('/tmp/book.mp3.tmp');
  });

  it.each([
    ['with an ASIN', 'B0TESTASIN'],
    ['without an ASIN', undefined],
  ])('m4b %s: ffmpeg always writes moov first (+faststart), so a refused post-step still leaves it first', async (_n, asin) => {
    mockExecFileSuccess('done');

    await tagAudioFileMetadata('/tmp/book.m4b', { title: 'Book', author: 'Author', asin });

    const argv = lastCallArgv();
    expect(argv[argv.indexOf('-movflags') + 1]).toBe('+faststart');
    expect(freeform.calls).toEqual([]); // the tagger never runs the post-step itself
  });

  it('the ffmpeg timeout scales with the file size (+faststart writes it twice)', async () => {
    fsMock.stat.mockResolvedValueOnce({ size: 3 * 1024 ** 3 });
    mockExecFileSuccess('done');

    await tagAudioFileMetadata('/tmp/big.m4b', { title: 'Book', author: 'Author' });

    expect(execFileMock.mock.calls.at(-1)?.[2]).toMatchObject({ timeout: 480_000 });
  });

  it('ffmpegRemuxTimeoutMs: 120 s plus 120 s per GiB', () => {
    expect(ffmpegRemuxTimeoutMs(0)).toBe(120_000);
    expect(ffmpegRemuxTimeoutMs(1024 ** 3)).toBe(240_000);
    expect(ffmpegRemuxTimeoutMs(1.5 * 1024 ** 3)).toBe(300_000);
    expect(ffmpegRemuxTimeoutMs(10 * 1024 ** 3)).toBe(1_320_000);
  });

  it('a missing file is an error, ffmpeg never runs', async () => {
    fsMock.stat.mockRejectedValueOnce(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }));

    const result = await tagAudioFileMetadata('/tmp/gone.m4b', { title: 'Book', author: 'Author' });

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('ENOENT') });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('mp3/flac keep the ASIN in argv', async () => {
    for (const file of ['/tmp/book.mp3', '/tmp/book.flac']) {
      mockExecFileSuccess('done');
      await tagAudioFileMetadata(file, { title: 'Book', author: 'Author', asin: 'B0TESTASIN' });
      expectMetadataArg(lastCallArgv(), 'ASIN', 'B0TESTASIN');
    }
    expect(freeform.calls).toEqual([]);
  });

  it.each(['.m4b', '.M4A', '.mp4'])('addMp4FreeformTags (%s): the sanitized ASIN goes to the post-step, its result comes back', async (ext) => {
    freeform.result = { written: false, warning: 'ASIN tag not written (meta handler is not mdir)' };

    const result = await addMp4FreeformTags('/tmp/merged.part', ext, { asin: ' B0TESTASIN\n' });

    expect(freeform.calls).toEqual([['/tmp/merged.part', [{ name: 'ASIN', value: 'B0TESTASIN' }]]]);
    expect(result).toEqual({ written: false, warning: 'ASIN tag not written (meta handler is not mdir)' });
  });

  it.each(['.mp3', '.flac'])('addMp4FreeformTags (%s): not an MP4, nothing to do', async (ext) => {
    expect(await addMp4FreeformTags('/tmp/book.tmp', ext, { asin: 'B0TESTASIN' })).toEqual({ written: false });
    expect(freeform.calls).toEqual([]);
  });

  it('buildMp4FreeformTags: sanitized ASIN, nothing when absent or blank', () => {
    expect(buildMp4FreeformTags({ asin: ' B0TEST\nASIN ' })).toEqual([{ name: 'ASIN', value: 'B0TESTASIN' }]);
    expect(buildMp4FreeformTags({ asin: '\u00a0 ' })).toEqual([]);
    expect(buildMp4FreeformTags({})).toEqual([]);
  });

  it('tags multiple files in sequence', async () => {
    fsMock.access.mockResolvedValue(undefined);
    mockExecFileSuccess('done');

    const results = await tagMultipleFiles(['/tmp/one.m4a', '/tmp/two.m4a'], {
      title: 'Book',
      author: 'Author',
    });

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.success)).toBe(true);
  });

  it('checks ffmpeg availability', async () => {
    mockExecFileSuccess('ffmpeg version');
    await expect(checkFfmpegAvailable()).resolves.toBe(true);

    mockExecFileFailure('not installed');
    await expect(checkFfmpegAvailable()).resolves.toBe(false);
  });

  describe('series metadata', () => {
    it('writes show/episode_id for m4b when series/seriesPart provided', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Book',
        author: 'Author',
        series: 'The Mistborn Saga',
        seriesPart: '1',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'show', 'The Mistborn Saga');
      expectMetadataArg(argv, 'episode_id', '1');
    });

    it('writes SERIES/SERIES-PART for mp3 when series/seriesPart provided', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.mp3', {
        title: 'Book',
        author: 'Author',
        series: 'The Mistborn Saga',
        seriesPart: '1.5',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'SERIES', 'The Mistborn Saga');
      expectMetadataArg(argv, 'SERIES-PART', '1.5');
    });

    it('writes SERIES/SERIES-PART for flac when series/seriesPart provided', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.flac', {
        title: 'Book',
        author: 'Author',
        series: 'The Mistborn Saga',
        seriesPart: '2',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'SERIES', 'The Mistborn Saga');
      expectMetadataArg(argv, 'SERIES-PART', '2');
    });

    it('omits series tags when fields are absent', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Book',
        author: 'Author',
      });

      const argv = lastCallArgv();
      const payloads = argv.filter((_, i) => i > 0 && argv[i - 1] === '-metadata');
      expect(payloads.some((p) => p.startsWith('show='))).toBe(false);
      expect(payloads.some((p) => p.startsWith('episode_id='))).toBe(false);
      expect(payloads.some((p) => p.startsWith('SERIES='))).toBe(false);
      expect(payloads.some((p) => p.startsWith('SERIES-PART='))).toBe(false);
    });
  });

  describe('description, genre and audiobook flags', () => {
    const DESCRIPTION = 'A heist on Luthadel.\n\nThe second paragraph.';
    const FLAT_DESCRIPTION = 'A heist on Luthadel. The second paragraph.';
    const GENRES = ['Science Fiction & Fantasy', 'Mystery, Thriller & Suspense'];
    const GENRE_TAG = 'Science Fiction & Fantasy; Mystery, Thriller & Suspense';

    function metadataPayloads(argv: string[]): string[] {
      return argv.filter((_, i) => i > 0 && argv[i - 1] === '-metadata');
    }

    const payloadFor = (argv: string[], key: string) =>
      metadataPayloads(argv).filter((p) => p.startsWith(`${key}=`)).map((p) => p.slice(key.length + 1));

    it('m4b: writes desc + ldes, joined genres, media type Audiobook and gapless, before -movflags and -f mp4', async () => {
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Book',
        author: 'Author',
        description: DESCRIPTION,
        genres: GENRES,
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'description', FLAT_DESCRIPTION);
      expectMetadataArg(argv, 'synopsis', FLAT_DESCRIPTION);
      expectMetadataArg(argv, 'genre', GENRE_TAG);
      expectMetadataArg(argv, 'media_type', '2');
      expectMetadataArg(argv, 'gapless_playback', '1');
      expect(argv.slice(-5)).toEqual(['-movflags', '+faststart', '-f', 'mp4', '/tmp/book.m4b.tmp']);
    });

    it('m4b: always marks the file as an audiobook, even without description or genres', async () => {
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4a', { title: 'Book', author: 'Author' });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'media_type', '2');
      expectMetadataArg(argv, 'gapless_playback', '1');
      const payloads = metadataPayloads(argv);
      expect(payloads.some((p) => p.startsWith('description='))).toBe(false);
      expect(payloads.some((p) => p.startsWith('synopsis='))).toBe(false);
      expect(payloads.some((p) => p.startsWith('genre='))).toBe(false);
    });

    it('mp3: writes description (TXXX) and joined genres, no MP4-only fields', async () => {
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.mp3', { title: 'Book', author: 'Author', description: DESCRIPTION, genres: GENRES });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'description', FLAT_DESCRIPTION);
      expectMetadataArg(argv, 'genre', GENRE_TAG);
      for (const key of ['comment', 'synopsis', 'media_type', 'gapless_playback']) {
        expect(payloadFor(argv, key)).toEqual([]);
      }
    });

    it('flac: writes the description as comment (the Vorbis DESCRIPTION field), never a second description key', async () => {
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.flac', { title: 'Book', author: 'Author', description: DESCRIPTION, genres: GENRES });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'comment', FLAT_DESCRIPTION);
      expectMetadataArg(argv, 'genre', GENRE_TAG);
      for (const key of ['description', 'synopsis', 'media_type', 'gapless_playback']) {
        expect(payloadFor(argv, key)).toEqual([]);
      }
    });

    it('turns CRLF and indented line breaks into single spaces (words never run together)', async () => {
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Book',
        author: 'Author',
        description: '  First line.\r\n\r\n   Second line.\nThird\u0000 line.  ',
      });

      expectMetadataArg(lastCallArgv(), 'description', 'First line. Second line. Third line.');
    });

    it('turns U+2028/U+2029, tabs, VT and FF into spaces and drops other C0 controls', async () => {
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.mp3', {
        title: 'Book',
        author: 'Author',
        description: 'One.\u2028Two.\u2029Three.\tFour\u0007\u001b five\u000bsix\u000cseven.',
      });

      expectMetadataArg(lastCallArgv(), 'description', 'One. Two. Three. Four five six seven.');
    });

    it('sanitizes each genre and drops empty ones', async () => {
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Book',
        author: 'Author',
        genres: ['\ufeff Romance ', '', '   ', 'History'],
      });

      expectMetadataArg(lastCallArgv(), 'genre', 'Romance; History');
    });

    it("replaces '/' inside a genre name with ' & ' (Audiobookshelf would split on it)", async () => {
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Book',
        author: 'Author',
        genres: ['Science Fiction/Fantasy', 'Mystery / Thriller'],
      });

      expectMetadataArg(lastCallArgv(), 'genre', 'Science Fiction & Fantasy; Mystery & Thriller');
    });

    it('omits description and genre when they sanitize to empty', async () => {
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.mp3', {
        title: 'Book',
        author: 'Author',
        description: ' \r\n ',
        genres: [' ', ''],
      });

      const payloads = metadataPayloads(lastCallArgv());
      expect(payloads.some((p) => p.startsWith('description='))).toBe(false);
      expect(payloads.some((p) => p.startsWith('genre='))).toBe(false);
    });

    it('caps a 200 KB description at 16 KiB in both MP4 fields, cut at a word boundary with an ellipsis', async () => {
      mockExecFileSuccess('done');
      const huge = 'word '.repeat(40_000); // 200,000 bytes

      await tagAudioFileMetadata('/tmp/book.m4b', { title: 'Book', author: 'Author', description: huge });

      const argv = lastCallArgv();
      for (const key of ['description', 'synopsis']) {
        const [value] = payloadFor(argv, key);
        expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(MAX_DESCRIPTION_BYTES);
        expect(Buffer.byteLength(value, 'utf8')).toBeGreaterThan(MAX_DESCRIPTION_BYTES - 16);
        expect(value.endsWith('word\u2026')).toBe(true);
        const head = value.slice(0, -1);
        expect(huge.startsWith(head)).toBe(true);
        expect(huge[head.length]).toBe(' '); // the cut falls between words
      }
    });

    it('collapses a whitespace-only line or a run of tabs into one space', async () => {
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.mp3', { title: 'Book', author: 'Author', description: 'One.\n   \n\t\tTwo.  \t Three.' });

      expectMetadataArg(lastCallArgv(), 'description', 'One. Two. Three.');
    });

    it.each([
      // past the raw bound: cut to spaces only, so no description at all
      [200_000, []],
      // inside the raw bound: the whitespace regex alone (the old one took ~30 s here)
      [60_000, ['x']],
    ])('sanitizes %i spaces before a word in linear time (was quadratic: ~1 min at 200k)', async (spaces, expected) => {
      mockExecFileSuccess('done');
      const started = performance.now();

      await tagAudioFileMetadata('/tmp/book.m4b', { title: 'Book', author: 'Author', description: ' '.repeat(spaces) + 'x' });

      expect(performance.now() - started).toBeLessThan(1000);
      expect(payloadFor(lastCallArgv(), 'description')).toEqual(expected);
    });

    it('bounds a 1 MB mixed-whitespace description: fast, single spaces, within the cap', async () => {
      mockExecFileSuccess('done');
      const chunk = 'word \t\r\n\u000b\u000c\u2028\u2029 ';
      const huge = chunk.repeat(Math.ceil(1_000_000 / chunk.length));
      const started = performance.now();

      await tagAudioFileMetadata('/tmp/book.m4b', { title: 'Book', author: 'Author', description: huge });

      expect(performance.now() - started).toBeLessThan(1000);
      const [value] = payloadFor(lastCallArgv(), 'description');
      expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(MAX_DESCRIPTION_BYTES);
      expect(value).toMatch(/^word( word)+\u2026$/);
    });

    it("replaces ';' inside a genre name with ' & ' too", async () => {
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', { title: 'Book', author: 'Author', genres: ['Sci-Fi; Horror', ' ; History / '] });

      expectMetadataArg(lastCallArgv(), 'genre', 'Sci-Fi & Horror; History');
    });

    it('sanitizes a genre with 200,000 spaces (and one with spaces around a slash) in linear time', async () => {
      mockExecFileSuccess('done');
      const started = performance.now();

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Book',
        author: 'Author',
        genres: [' '.repeat(200_000) + 'x', ' '.repeat(1_000) + '/' + ' '.repeat(1_000) + 'y'],
      });

      expect(performance.now() - started).toBeLessThan(1000);
      expectMetadataArg(lastCallArgv(), 'genre', 'x; y');
    });

    it('a failed run reports ffmpeg stderr, never the argv (so no description in job logs)', async () => {
      execFileMock.mockImplementation((file: string, args: string[], options: unknown, callback?: unknown) => {
        const cb = (typeof options === 'function' ? options : callback) as (e: Error, out: string, err: string) => void;
        const error = Object.assign(new Error(`Command failed: ffmpeg ${args.join(' ')}\nInvalid data found`), {
          code: 1,
          stderr: 'Input #0 ...\n[mp3 @ 0x1] Header missing\nInvalid data found when processing input\n',
        });
        cb(error, '', '');
      });

      const result = await tagAudioFileMetadata('/tmp/book.mp3', { title: 'Book', author: 'Author', description: 'SECRET summary text' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid data found when processing input');
      expect(result.error).not.toContain('SECRET');
      expect(result.error).not.toContain('-metadata');
    });

  });

  describe('quote regression (#171) — embedded `"` flows through untouched', () => {
    const tricky = 'Test "Quoted" Book';

    it('m4b: embedded double-quote in title is a single clean argv element', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: tricky,
        author: 'Author',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'title', tricky);
      expectMetadataArg(argv, 'album', tricky);
      // Adjacent fields must not have inherited a stray leading `"`.
      expectMetadataArg(argv, 'album_artist', 'Author');
      expectMetadataArg(argv, 'artist', 'Author');
    });

    it('mp3: embedded double-quote in author is a single clean argv element', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.mp3', {
        title: 'Book',
        author: 'Alexandre "Dumas',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'album_artist', 'Alexandre "Dumas');
      expectMetadataArg(argv, 'artist', 'Alexandre "Dumas');
      // Title must NOT have inherited a leading quote (the exact #171 symptom).
      expectMetadataArg(argv, 'title', 'Book');
    });

    it('flac: embedded double-quote in series flows through cleanly', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.flac', {
        title: 'Book',
        author: 'Author',
        series: 'The "Final" Saga',
        seriesPart: '1',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'SERIES', 'The "Final" Saga');
      expectMetadataArg(argv, 'SERIES-PART', '1');
    });
  });

  describe('special characters flow through as literals (no shell escaping)', () => {
    it('single quotes are untouched', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: "It's Not Her",
        author: "O'Brien",
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'title', "It's Not Her");
      expectMetadataArg(argv, 'album_artist', "O'Brien");
    });

    it('dollar signs are untouched (no shell variable expansion)', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Book $100',
        author: 'Author',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'title', 'Book $100');
    });

    it('backticks are untouched (no command substitution)', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Book `test`',
        author: 'Author',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'title', 'Book `test`');
    });

    it('backslashes are untouched', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Path\\to\\book',
        author: 'Author',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'title', 'Path\\to\\book');
    });

    it('combined torture-test value flows through as one literal argv element', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      const tortureTitle = `Don't Say "Hello" for $5 \`backtick\` and \\back`;

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: tortureTitle,
        author: "O'Brien",
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'title', tortureTitle);
      expectMetadataArg(argv, 'album_artist', "O'Brien");
    });
  });

  describe('input sanitization (boundary defense for invisible chars)', () => {
    it('strips leading BOM from title', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: '﻿Alexandre Dumas Title',
        author: 'Author',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'title', 'Alexandre Dumas Title');
    });

    it('strips leading NBSP from author', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Book',
        author: ' Alexandre Dumas',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'album_artist', 'Alexandre Dumas');
      expectMetadataArg(argv, 'artist', 'Alexandre Dumas');
    });

    it('strips leading zero-width chars', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: '​‌‍Book Title',
        author: 'Author',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'title', 'Book Title');
    });

    it('trims surrounding whitespace', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: '   Spaced Book   ',
        author: '\tAuthor Name\t',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'title', 'Spaced Book');
      expectMetadataArg(argv, 'album_artist', 'Author Name');
    });

    it('strips null bytes and line breaks anywhere in value', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Book\x00With\nBreaks\r',
        author: 'Author',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'title', 'BookWithBreaks');
    });

    it('leaves clean inputs untouched', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Perfectly Clean Title',
        author: 'Clean Author',
        narrator: 'Clean Narrator',
        asin: 'B0009JKV9W',
        series: 'Clean Series',
        seriesPart: '1',
      });

      const argv = lastCallArgv();
      expectMetadataArg(argv, 'title', 'Perfectly Clean Title');
      expectMetadataArg(argv, 'album_artist', 'Clean Author');
      expectMetadataArg(argv, 'composer', 'Clean Narrator');
      expect(hasFreeformArg(argv)).toBe(false);
      expectMetadataArg(argv, 'show', 'Clean Series');
      expectMetadataArg(argv, 'episode_id', '1');
    });

    it('sanitization applies across all three format branches', async () => {
      fsMock.access.mockResolvedValue(undefined);

      for (const filePath of ['/tmp/book.m4b', '/tmp/book.mp3', '/tmp/book.flac']) {
        mockExecFileSuccess('done');
        await tagAudioFileMetadata(filePath, {
          title: '﻿  Dirty Title  ',
          author: ' Dirty Author',
        });
        const argv = lastCallArgv();
        expectMetadataArg(argv, 'title', 'Dirty Title');
        // m4b/mp3 use album_artist; flac uses albumartist (no underscore).
        const authorKey = filePath.endsWith('.flac') ? 'albumartist' : 'album_artist';
        expectMetadataArg(argv, authorKey, 'Dirty Author');
      }
    });
  });

  describe('argv structural integrity', () => {
    it('no -metadata payload starts or ends with `"` (the #171 bug class)', async () => {
      fsMock.access.mockResolvedValue(undefined);

      const torture = {
        title: 'Has "quotes" $dollar `tick` \\back',
        author: 'A "B" C',
        narrator: 'N "ar" tor',
        asin: 'ASIN"123',
        series: 'Ser "ies"',
        seriesPart: '"1"',
        year: 2020,
      };

      for (const filePath of ['/tmp/book.m4b', '/tmp/book.mp3', '/tmp/book.flac']) {
        mockExecFileSuccess('done');
        await tagAudioFileMetadata(filePath, torture);
        const argv = lastCallArgv();
        for (let i = 0; i < argv.length - 1; i++) {
          if (argv[i] === '-metadata') {
            const payload = argv[i + 1];
            // Split key=value; the VALUE part must not have leading/trailing wrapping quotes.
            const eqIdx = payload.indexOf('=');
            const value = eqIdx >= 0 ? payload.substring(eqIdx + 1) : payload;
            // The seriesPart torture value is literally '"1"', so we check that the value
            // matches one of the original torture values (no extra wrapping was added).
            if (value.startsWith('"') && value.endsWith('"')) {
              // Only acceptable when the original input was already wrapped (seriesPart='"1"').
              expect(value).toBe('"1"');
            }
          }
        }
      }
    });

    it('input and output paths are passed as single argv elements (no quote wrapping)', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/path with spaces/book.m4b', {
        title: 'Book',
        author: 'Author',
      });

      const argv = lastCallArgv();
      const iIdx = argv.indexOf('-i');
      expect(iIdx).toBeGreaterThanOrEqual(0);
      expect(argv[iIdx + 1]).toBe('/path with spaces/book.m4b');
      expect(argv[argv.length - 1]).toBe('/path with spaces/book.m4b.tmp');
    });

    it('execFile is called with command "ffmpeg" (not a shell)', async () => {
      fsMock.access.mockResolvedValue(undefined);
      mockExecFileSuccess('done');

      await tagAudioFileMetadata('/tmp/book.m4b', {
        title: 'Book',
        author: 'Author',
      });

      expect(execFileMock).toHaveBeenCalled();
      expect(lastCallCommand()).toBe('ffmpeg');
    });
  });
});
