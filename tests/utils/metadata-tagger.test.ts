/**
 * Component: Metadata Tagging Utility Tests
 * Documentation: documentation/phase3/file-organization.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkFfmpegAvailable, tagAudioFileMetadata, tagMultipleFiles } from '@/lib/utils/metadata-tagger';

const execFileMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('fs/promises', () => ({
  default: fsMock,
  ...fsMock,
}));

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
    expectMetadataArg(argv, '----:com.apple.iTunes:ASIN', 'ASIN123');

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
      expectMetadataArg(argv, '----:com.apple.iTunes:ASIN', 'B0009JKV9W');
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
