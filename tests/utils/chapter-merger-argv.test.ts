/**
 * Component: Chapter Merger argv / list-file safety tests
 * Documentation: documentation/features/chapter-merging.md
 *
 * Untrusted paths and tag values must reach ffmpeg/ffprobe as untouched argv
 * elements (no shell), and must not be able to add lines to the concat list
 * or the ffmetadata chapter file.
 */

import { EventEmitter } from 'events';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeChapters, probeAudioFile, type ChapterFile } from '@/lib/utils/chapter-merger';

const execFileMock = vi.hoisted(() => {
  const execFile = vi.fn();
  // promisify(execFile) -> { stdout, stderr }; records the raw (file, args, options) call
  (execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] = (
    file: string,
    args: string[],
    options?: unknown
  ) => {
    execFile(file, args, options);
    const stdout = file === 'ffprobe'
      ? JSON.stringify({ format: { duration: '120', bit_rate: '128000', tags: {} } })
      : '';
    return Promise.resolve({ stdout, stderr: '' });
  };
  return execFile;
});
const spawnMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  constants: { R_OK: 4 },
}));

vi.mock('child_process', () => ({ execFile: execFileMock, spawn: spawnMock }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

const HOSTILE_DIR = '/dl/My $(touch pwned) `id` "dq" \'sq\' Book';

function createSpawnProcess() {
  const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  setImmediate(() => proc.emit('close', 0));
  return proc;
}

function chapter(p: string, chapterTitle = 'Chapter'): ChapterFile {
  return { path: p, filename: path.basename(p), duration: 60000, bitrate: 128, chapterTitle };
}

/** Content written to the temp file whose name starts with `prefix` (concat_ / chapters_). */
function writtenFile(prefix: string): { file: string; content: string } | undefined {
  const call = fsMock.writeFile.mock.calls.find(([file]: [string]) => path.basename(file).startsWith(prefix));
  return call ? { file: call[0], content: String(call[1]) } : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.access.mockResolvedValue(undefined);
  fsMock.mkdir.mockResolvedValue(undefined);
  fsMock.writeFile.mockResolvedValue(undefined);
  fsMock.unlink.mockResolvedValue(undefined);
  fsMock.stat.mockImplementation(async (filePath: string) =>
    filePath.endsWith('.m4b') ? { size: 2 * 1024 * 1024 } : { size: 500 * 1024 }
  );
  spawnMock.mockImplementation(() => createSpawnProcess());
});

describe('chapter merger argv safety (no shell)', () => {
  it('probes with execFile and the path as one untouched argv element', async () => {
    const filePath = `${HOSTILE_DIR}/01.m4a`;

    await probeAudioFile(filePath);

    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: 30000 }
    );
  });

  it('passes every path verbatim and restricts concat inputs to the file protocol', async () => {
    const outputPath = `${HOSTILE_DIR}/out.m4b`;
    const chapters = [chapter(`${HOSTILE_DIR}/01.m4a`), chapter(`${HOSTILE_DIR}/02.m4a`)];

    const result = await mergeChapters(chapters, { title: 'Book', author: 'Author', outputPath });

    expect(result.success).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [bin, args, spawnOptions] = spawnMock.mock.calls[0] as [string, string[], unknown];
    expect(bin).toBe('ffmpeg');
    expect(spawnOptions).toBeUndefined();
    expect(args.slice(0, 7)).toEqual(['-y', '-f', 'concat', '-safe', '0', '-protocol_whitelist', 'file']);
    // The concat input is exactly the list file that was written; output path is last and unquoted
    const concat = writtenFile('concat_');
    expect(concat).toBeDefined();
    expect(args[args.indexOf('-i') + 1]).toBe(concat!.file);
    expect(args[args.length - 1]).toBe(outputPath);

    // Decode checks get the output path as its own argv element
    const decodeCalls = execFileMock.mock.calls.filter(
      ([file, a]: [string, string[]]) => file === 'ffmpeg' && a.includes('null')
    );
    expect(decodeCalls).toHaveLength(2);
    for (const [, a] of decodeCalls) {
      expect(a[a.indexOf('-i') + 1]).toBe(outputPath);
    }
  });

  it("writes concat entries with ' escaped as '\\'' and tabs kept verbatim", async () => {
    const chapters = [chapter("/dl/O'Brien's Book/01.m4a"), chapter('/dl/Tab\tBook/02.m4a')];

    const result = await mergeChapters(chapters, { title: 'Book', author: 'Author', outputPath: '/tmp/out.m4b' });

    expect(result.success).toBe(true);
    expect(writtenFile('concat_')!.content).toBe(
      "file '/dl/O'\\''Brien'\\''s Book/01.m4a'\nfile '/dl/Tab\tBook/02.m4a'"
    );
  });

  it.each([
    ['newline', '\n'],
    ['carriage return', '\r'],
    ['NUL', '\0'],
  ])('refuses to merge when a directory name holds a %s (no injected concat line)', async (_label, ch) => {
    const badPath = `/dl/Book${ch}file '/etc/passwd/01.m4a`;
    const chapters = [chapter('/dl/ok/00.m4a'), chapter(badPath)];

    const result = await mergeChapters(chapters, { title: 'Book', author: 'Author', outputPath: '/tmp/out.m4b' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('line break or NUL');
    expect(result.error).toContain(JSON.stringify(badPath));
    expect(writtenFile('concat_')).toBeUndefined();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('strips CR, LF and NUL from chapter titles so a title cannot add a chapter', async () => {
    const chapters = [
      chapter('/dl/a/01.m4a', 'One\r[CHAPTER]\rTIMEBASE=1/1000\rSTART=0\rEND=1\rtitle=Bogus'),
      chapter('/dl/a/02.m4a', 'Two\nthree\0four'),
    ];

    const result = await mergeChapters(chapters, { title: 'Book', author: 'Author', outputPath: '/tmp/out.m4b' });

    expect(result.success).toBe(true);
    const metadata = writtenFile('chapters_')!.content;
    expect(metadata).not.toMatch(/[\r\0]/);
    expect(metadata.match(/^\[CHAPTER\]$/gm)).toHaveLength(2);
    expect(metadata).toContain('title=Twothreefour\n');
  });
});
