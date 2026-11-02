/**
 * Component: Metadata Tagging Utility Tests (disc and track of a multi-disc book)
 * Documentation: documentation/features/multi-disc-folders.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tagAudioFileMetadata, tagMultipleFiles } from '@/lib/utils/metadata-tagger';

const execFileMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  stat: vi.fn(async () => ({ size: 1024 })),
  unlink: vi.fn(),
}));

vi.mock('child_process', () => ({ execFile: execFileMock }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));
vi.mock('@/lib/utils/mp4-freeform-tags', () => ({ addFreeformTags: async () => ({ written: false }) }));

const BOOK = { title: 'Book', author: 'Author' };

function mockExecFileSuccess() {
  execFileMock.mockImplementation((file: string, args: string[], options: unknown, callback?: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (e: Error | null, out: string, err: string) => void;
    cb(null, 'ok', '');
  });
}

function lastCallArgv(): string[] {
  const call = execFileMock.mock.calls.at(-1);
  if (!call) throw new Error('execFile was not called');
  return call[1] as string[];
}

/** The `-metadata` payloads of an argv for the given keys, in argv order (each a single element). */
const payloads = (argv: string[], keys: RegExp) =>
  argv.flatMap((a, i) => (argv[i - 1] === '-metadata' && keys.test(a.split('=')[0]) ? [a] : []));
const POSITION_KEYS = /^(disc|track|DISCNUMBER|TRACKTOTAL|TOTALTRACKS|DISCTOTAL|TOTALDISCS)$/;

describe('disc and track of a multi-disc book', () => {
  const position = { disc: '2/3', track: '12/20' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFileSuccess();
  });

  it.each(['/tmp/book.m4b', '/tmp/book.mp3'])('%s: disc and track are single argv elements before the output', async (file) => {
    await tagAudioFileMetadata(file, BOOK, position);
    const argv = lastCallArgv();
    expect(payloads(argv, POSITION_KEYS)).toEqual(['disc=2/3', 'track=12/20']);
    expect(argv.at(-1)).toBe(`${file}.tmp`);
  });

  it('flac: the track and disc totals are replaced too, so no stale total is left', async () => {
    await tagAudioFileMetadata('/tmp/book.flac', BOOK, position);
    const argv = lastCallArgv();
    expect(payloads(argv, POSITION_KEYS)).toEqual([
      'disc=2/3', 'DISCTOTAL=3', 'TOTALDISCS=3', 'track=12/20', 'TRACKTOTAL=20', 'TOTALTRACKS=20',
    ]);
    expect(argv.at(-1)).toBe('/tmp/book.flac.tmp');
  });

  it('a position without a disc clears the source disc (empty values) and writes the track', async () => {
    await tagAudioFileMetadata('/tmp/book.flac', BOOK, { track: '3/20' });
    expect(payloads(lastCallArgv(), POSITION_KEYS)).toEqual([
      'disc=', 'DISCNUMBER=', 'DISCTOTAL=', 'TOTALDISCS=', 'track=3/20', 'TRACKTOTAL=20', 'TOTALTRACKS=20',
    ]);
    await tagAudioFileMetadata('/tmp/book.m4b', BOOK, { track: '3/20' });
    expect(payloads(lastCallArgv(), POSITION_KEYS)).toEqual(['disc=', 'track=3/20']);
  });

  it('without a position the argv is exactly as before', async () => {
    await tagAudioFileMetadata('/tmp/book.mp3', BOOK);
    const before = lastCallArgv();
    await tagMultipleFiles(['/tmp/book.mp3'], BOOK, [undefined]);
    expect(lastCallArgv()).toEqual(before);
    expect(payloads(before, POSITION_KEYS)).toEqual([]);
  });

  it('tagMultipleFiles gives each file its own position', async () => {
    await tagMultipleFiles(['/tmp/a.mp3', '/tmp/b.mp3'], BOOK, [
      { disc: '1/2', track: '1/2' }, { disc: '2/2', track: '2/2' },
    ]);
    const [first, second] = execFileMock.mock.calls.slice(-2).map((call) => call[1] as string[]);
    expect(payloads(first, POSITION_KEYS)).toEqual(['disc=1/2', 'track=1/2']);
    expect(payloads(second, POSITION_KEYS)).toEqual(['disc=2/2', 'track=2/2']);
  });

  it.each([
    { disc: '1/2', track: '1/2 -y' },
    { disc: '1/2 -y', track: '1/2' },
  ])('a value that is not n/N is never written (%o)', async (bad) => {
    await tagAudioFileMetadata('/tmp/book.flac', BOOK, bad);
    expect(payloads(lastCallArgv(), POSITION_KEYS)).toEqual([]);
  });
});
