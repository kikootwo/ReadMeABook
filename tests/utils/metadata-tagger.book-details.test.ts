/**
 * Component: Metadata Tagging Utility Tests (publisher, subtitle, language)
 * Documentation: documentation/phase3/file-organization.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addMp4FreeformTags, buildMp4FreeformTags, tagAudioFileMetadata } from '@/lib/utils/metadata-tagger';
import { MAX_SHORT_TAG_BYTES } from '@/lib/utils/metadata-text';

const execFileMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  stat: vi.fn(async () => ({ size: 1024 })),
  unlink: vi.fn(),
}));

vi.mock('child_process', () => ({ execFile: execFileMock }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

// The freeform-tag post-step (real-file behaviour: the book-details integration tests). Plain holder: survives mock resets.
const freeform = vi.hoisted(() => ({ calls: [] as Array<[string, Array<{ name: string; value: string }>]> }));
vi.mock('@/lib/utils/mp4-freeform-tags', () => ({
  addFreeformTags: async (file: string, tags: Array<{ name: string; value: string }>) => {
    freeform.calls.push([file, tags]);
    return { written: tags.length > 0 };
  },
}));

const BOOK = { title: 'Book', author: 'Author' };
const DETAILS = { publisher: 'Penguin Audio', subtitle: 'An Easy & Proven Way', language: 'english' };
const DETAIL_KEYS = ['publisher=', 'subtitle=', 'TIT3=', 'language='];

function mockExecFileSuccess() {
  execFileMock.mockImplementation((_file: string, _args: string[], options: unknown, callback?: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (e: Error | null, out: string, err: string) => void;
    cb(null, 'ok', '');
  });
}

/** The `-metadata` payloads of the last ffmpeg call. */
function lastPayloads(): string[] {
  const argv = execFileMock.mock.calls.at(-1)?.[1] as string[] | undefined;
  if (!argv) throw new Error('execFile was not called');
  return argv.filter((_, i) => i > 0 && argv[i - 1] === '-metadata');
}

describe('metadata tagger: publisher, subtitle, language', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    freeform.calls.length = 0;
    mockExecFileSuccess();
  });

  describe('buildMp4FreeformTags', () => {
    it('adds PUBLISHER, SUBTITLE and LANGUAGE after the ASIN, the language capitalized', () => {
      expect(buildMp4FreeformTags({ asin: 'B0TESTASIN', ...DETAILS })).toEqual([
        { name: 'ASIN', value: 'B0TESTASIN' },
        { name: 'PUBLISHER', value: 'Penguin Audio' },
        { name: 'SUBTITLE', value: 'An Easy & Proven Way' },
        { name: 'LANGUAGE', value: 'English' },
      ]);
    });

    it('leaves out a value that is empty once sanitized, so the ASIN is still written', () => {
      expect(buildMp4FreeformTags({ asin: 'B0TESTASIN', publisher: '  ', subtitle: '\r\n', language: '\u0000' })).toEqual([
        { name: 'ASIN', value: 'B0TESTASIN' },
      ]);
    });

    it('writes well-formed, bounded values (the post-step reads every value back byte for byte)', () => {
      const tags = buildMp4FreeformTags({ subtitle: 'Half \ud800 pair', publisher: 'word '.repeat(1000), language: 'A \uFFFE B' });
      expect(tags.find((t) => t.name === 'SUBTITLE')?.value).toBe('Half \uFFFD pair');
      expect(tags.find((t) => t.name === 'LANGUAGE')?.value).toBe('A \uFFFD B');
      const publisher = tags.find((t) => t.name === 'PUBLISHER')!.value;
      expect(Buffer.byteLength(publisher, 'utf8')).toBeLessThanOrEqual(MAX_SHORT_TAG_BYTES);
    });

    it('writes the book details without an ASIN too', () => {
      expect(buildMp4FreeformTags({ publisher: 'Penguin Audio' })).toEqual([{ name: 'PUBLISHER', value: 'Penguin Audio' }]);
    });
  });

  it.each(['.m4b', '.m4a'])('addMp4FreeformTags (%s) hands all four tags to the post-step', async (ext) => {
    await addMp4FreeformTags('/tmp/book.tmp', ext, { asin: 'B0TESTASIN', ...DETAILS });
    expect(freeform.calls.at(-1)?.[1].map((t) => t.name)).toEqual(['ASIN', 'PUBLISHER', 'SUBTITLE', 'LANGUAGE']);
  });

  it('addMp4FreeformTags does nothing for an mp3 (its tags went through ffmpeg)', async () => {
    await expect(addMp4FreeformTags('/tmp/book.tmp', '.mp3', { asin: 'B0TESTASIN', ...DETAILS })).resolves.toEqual({ written: false });
    expect(freeform.calls).toEqual([]);
  });

  it('m4b: ffmpeg gets none of the three (its mp4 muxer drops them); they go to the post-step', async () => {
    await tagAudioFileMetadata('/tmp/book.m4b', { ...BOOK, ...DETAILS });
    const payloads = lastPayloads();
    for (const key of DETAIL_KEYS) {
      expect(payloads.some((p) => p.startsWith(key))).toBe(false);
    }
  });

  it('mp3: TPUB, TIT3 (clearing a TXXX subtitle) and TLAN with the language name', async () => {
    await tagAudioFileMetadata('/tmp/book.mp3', { ...BOOK, ...DETAILS });
    const payloads = lastPayloads();
    expect(payloads.filter((p) => DETAIL_KEYS.some((key) => p.startsWith(key)))).toEqual([
      'publisher=Penguin Audio',
      'TIT3=An Easy & Proven Way',
      'subtitle=',
      'language=English',
    ]);
  });

  it('flac: publisher, subtitle and language Vorbis fields', async () => {
    await tagAudioFileMetadata('/tmp/book.flac', { ...BOOK, ...DETAILS });
    const payloads = lastPayloads();
    expect(payloads.filter((p) => DETAIL_KEYS.some((key) => p.startsWith(key)))).toEqual([
      'publisher=Penguin Audio',
      'subtitle=An Easy & Proven Way',
      'language=English',
    ]);
  });

  it.each(['/tmp/book.mp3', '/tmp/book.flac'])('%s: the values are sanitized and capped before argv', async (file) => {
    await tagAudioFileMetadata(file, { ...BOOK, publisher: 'Pen\r\nguin\tAudio', subtitle: 'word '.repeat(1000), language: ' german ' });
    const payloads = lastPayloads();
    expect(payloads).toContain('publisher=Pen guin Audio');
    expect(payloads).toContain('language=German');
    const subtitle = payloads.find((p) => p.startsWith(file.endsWith('.mp3') ? 'TIT3=' : 'subtitle=') && p.length > 9)!;
    expect(Buffer.byteLength(subtitle, 'utf8')).toBeLessThanOrEqual(MAX_SHORT_TAG_BYTES + 'subtitle='.length);
  });

  it.each(['/tmp/book.mp3', '/tmp/book.flac'])(
    '%s: without the details nothing is written or cleared (the source tags stay)',
    async (file) => {
      await tagAudioFileMetadata(file, { ...BOOK, publisher: ' ', subtitle: '', language: undefined });
      const payloads = lastPayloads();
      for (const key of DETAIL_KEYS) {
        expect(payloads.some((p) => p.startsWith(key))).toBe(false);
      }
    }
  );
});
