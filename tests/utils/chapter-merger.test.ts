/**
 * Component: Chapter Merger Utility Tests
 * Documentation: documentation/features/chapter-merging.md
 */

import { EventEmitter } from 'events';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeChapterFiles,
  checkDiskSpace,
  detectChapterFiles,
  estimateOutputSize,
  formatDuration,
  mergeChapters,
  probeAudioFile,
} from '@/lib/utils/chapter-merger';

const execState = vi.hoisted(() => {
  const state = {
    handler: null as null | ((command: string) => { stdout?: string; error?: Error }),
  };
  const custom = Symbol.for('nodejs.util.promisify.custom');
  const exec = vi.fn();
  (exec as any)[custom] = (command: string) =>
    new Promise((resolve, reject) => {
      const result = state.handler ? state.handler(command) : { stdout: '' };
      if (result.error) {
        reject(result.error);
        return;
      }
      resolve({ stdout: result.stdout ?? '', stderr: '' });
    });
  const execFile = vi.fn();
  (execFile as any)[custom] = (bin: string, args: string[]) =>
    (exec as any)[custom](`${bin} ${args.map(arg => JSON.stringify(arg)).join(' ')}`);
  return { exec, execFile, state };
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

vi.mock('child_process', () => ({
  exec: execState.exec,
  execFile: execState.execFile,
  spawn: spawnMock,
}));

vi.mock('fs/promises', () => ({
  default: fsMock,
  ...fsMock,
}));

function createSpawnProcess(exitCode = 0, stderrData = '') {
  const proc = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    kill: () => void;
  };
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();

  setImmediate(() => {
    if (stderrData) {
      proc.stderr.emit('data', Buffer.from(stderrData));
    }
    proc.emit('close', exitCode);
  });

  return proc;
}

function mockExecImplementation(handlers: (command: string) => { stdout?: string; error?: Error }) {
  execState.state.handler = handlers;
}

describe('chapter merger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execState.state.handler = null;
  });

  it('detects when chapter merging should be skipped', async () => {
    await expect(detectChapterFiles(['one.mp3', 'two.mp3'])).resolves.toBe(false);
    await expect(detectChapterFiles(['one.mp3', 'two.m4b', 'three.mp3'])).resolves.toBe(false);
    await expect(detectChapterFiles(['one.wav', 'two.wav', 'three.wav'])).resolves.toBe(false);
  });

  it('detects eligible chapter files', async () => {
    await expect(detectChapterFiles(['one.mp3', 'two.mp3', 'three.mp3'])).resolves.toBe(true);
  });

  it('orders chapters by metadata when track numbers are sequential', async () => {
    const files = ['/tmp/b.mp3', '/tmp/a.mp3', '/tmp/c.mp3'];
    const probeMap: Record<string, { duration: number; bitrate: number; track: number }> = {
      '/tmp/b.mp3': { duration: 60, bitrate: 128000, track: 1 },
      '/tmp/a.mp3': { duration: 60, bitrate: 128000, track: 2 },
      '/tmp/c.mp3': { duration: 60, bitrate: 128000, track: 3 },
    };

    mockExecImplementation((command) => {
      const matches = command.match(/"([^"]+)"/g) ?? [];
      const filePath = matches.length > 0 ? matches[matches.length - 1].replace(/"/g, '') : '';
      const probe = probeMap[filePath];
      if (!probe) {
        throw new Error(`Missing probe data for ${filePath}`);
      }
      const payload = {
        format: {
          duration: String(probe.duration),
          bit_rate: String(probe.bitrate),
          tags: { track: String(probe.track) },
        },
      };
      return { stdout: JSON.stringify(payload) };
    });

    const ordered = await analyzeChapterFiles(files);

    expect(ordered.map((file) => path.basename(file.path))).toEqual(['b.mp3', 'a.mp3', 'c.mp3']);
    expect(ordered[0].chapterTitle).toBe('Chapter 1');
  });

  it('orders chapters by filename when track numbers are missing', async () => {
    const files = ['/tmp/02 - Middle.mp3', '/tmp/01 - Start.mp3', '/tmp/03 - End.mp3'];
    const probeMap: Record<string, { duration: number; bitrate: number; title?: string }> = {
      '/tmp/02 - Middle.mp3': { duration: 60, bitrate: 128000 },
      '/tmp/01 - Start.mp3': { duration: 60, bitrate: 128000 },
      '/tmp/03 - End.mp3': { duration: 60, bitrate: 128000 },
    };

    mockExecImplementation((command) => {
      const matches = command.match(/"([^"]+)"/g) ?? [];
      const filePath = matches.length > 0 ? matches[matches.length - 1].replace(/"/g, '') : '';
      const probe = probeMap[filePath];
      if (!probe) {
        throw new Error(`Missing probe data for ${filePath}`);
      }
      const payload = {
        format: {
          duration: String(probe.duration),
          bit_rate: String(probe.bitrate),
          tags: {},
        },
      };
      return { stdout: JSON.stringify(payload) };
    });

    const ordered = await analyzeChapterFiles(files);

    expect(ordered.map((file) => path.basename(file.path))).toEqual([
      '01 - Start.mp3',
      '02 - Middle.mp3',
      '03 - End.mp3',
    ]);
    expect(ordered[0].chapterTitle).toBe('Start');
    expect(ordered[1].chapterTitle).toBe('Middle');
  });

  it('falls back to chapter numbers when metadata title is the book title', async () => {
    const files = ['/tmp/01.mp3', '/tmp/02.mp3', '/tmp/03.mp3'];
    const probeMap: Record<string, { duration: number; bitrate: number; track: number; title: string }> = {
      '/tmp/01.mp3': { duration: 60, bitrate: 128000, track: 1, title: 'Book Title' },
      '/tmp/02.mp3': { duration: 60, bitrate: 128000, track: 2, title: 'Book Title' },
      '/tmp/03.mp3': { duration: 60, bitrate: 128000, track: 3, title: 'Book Title' },
    };

    mockExecImplementation((command) => {
      const matches = command.match(/"([^"]+)"/g) ?? [];
      const filePath = matches.length > 0 ? matches[matches.length - 1].replace(/"/g, '') : '';
      const probe = probeMap[filePath];
      if (!probe) {
        throw new Error(`Missing probe data for ${filePath}`);
      }
      const payload = {
        format: {
          duration: String(probe.duration),
          bit_rate: String(probe.bitrate),
          tags: { track: String(probe.track), title: probe.title },
        },
      };
      return { stdout: JSON.stringify(payload) };
    });

    const ordered = await analyzeChapterFiles(files);

    expect(ordered[0].chapterTitle).toBe('Chapter 1');
    expect(ordered[1].chapterTitle).toBe('Chapter 2');
  });

  it('uses filename order when track numbers are not sequential', async () => {
    const files = ['/tmp/02 - Two.mp3', '/tmp/01 - One.mp3', '/tmp/03 - Three.mp3'];
    const probeMap: Record<string, { duration: number; bitrate: number; track: number }> = {
      '/tmp/02 - Two.mp3': { duration: 60, bitrate: 128000, track: 2 },
      '/tmp/01 - One.mp3': { duration: 60, bitrate: 128000, track: 1 },
      '/tmp/03 - Three.mp3': { duration: 60, bitrate: 128000, track: 4 },
    };

    mockExecImplementation((command) => {
      const matches = command.match(/"([^"]+)"/g) ?? [];
      const filePath = matches.length > 0 ? matches[matches.length - 1].replace(/"/g, '') : '';
      const probe = probeMap[filePath];
      if (!probe) {
        throw new Error(`Missing probe data for ${filePath}`);
      }
      const payload = {
        format: {
          duration: String(probe.duration),
          bit_rate: String(probe.bitrate),
          tags: { track: String(probe.track) },
        },
      };
      return { stdout: JSON.stringify(payload) };
    });

    const ordered = await analyzeChapterFiles(files);

    expect(ordered.map((file) => path.basename(file.path))).toEqual([
      '01 - One.mp3',
      '02 - Two.mp3',
      '03 - Three.mp3',
    ]);
  });

  it('formats durations for logs', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
    expect(formatDuration(3601000)).toBe('1h 0m 1s');
  });

  it('estimates output size with overhead', async () => {
    fsMock.stat.mockImplementation(async (filePath: string) => {
      if (filePath === '/tmp/one.mp3') return { size: 100 };
      if (filePath === '/tmp/two.mp3') return { size: 200 };
      throw new Error('missing');
    });

    const size = await estimateOutputSize(['/tmp/one.mp3', '/tmp/two.mp3', '/tmp/missing.mp3']);

    expect(size).toBe(330);
  });

  it('checks disk space when df output is available', async () => {
    mockExecImplementation(() => ({ stdout: '1024\n' }));

    const space = await checkDiskSpace('/tmp');

    expect(space).toBe(1024 * 1024);
  });

  it('returns null when disk space cannot be determined', async () => {
    mockExecImplementation(() => ({ error: new Error('df missing') }));

    const space = await checkDiskSpace('/tmp');

    expect(space).toBeNull();
  });

  it('returns an error when no chapters are provided', async () => {
    const result = await mergeChapters([], {
      title: 'Book',
      author: 'Author',
      outputPath: '/tmp/output.m4b',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No chapters');
  });

  it('merges chapters and returns success details', async () => {
    const outputPath = '/tmp/output.m4b';

    const chapters = [
      { path: '/tmp/one.mp3', filename: 'one.mp3', duration: 60000, bitrate: 128, chapterTitle: 'One' },
      { path: '/tmp/two.mp3', filename: 'two.mp3', duration: 60000, bitrate: 128, chapterTitle: 'Two' },
    ];

    fsMock.access.mockResolvedValue(undefined);
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);
    fsMock.stat.mockImplementation(async (filePath: string) => {
      if (filePath === outputPath) {
        return { size: 2 * 1024 * 1024 };
      }
      return { size: 500 * 1024 };
    });

    mockExecImplementation((command) => {
      if (command.startsWith('ffmpeg -encoders')) {
        return { stdout: 'aac encoder' };
      }
      if (command.startsWith('ffprobe')) {
        const payload = {
          format: {
            duration: '120',
            bit_rate: '128000',
            tags: {},
          },
        };
        return { stdout: JSON.stringify(payload) };
      }
      if (command.startsWith('ffmpeg -v error')) {
        return { stdout: '' };
      }
      return { error: new Error(`Unexpected command: ${command}`) };
    });

    spawnMock.mockReturnValue(createSpawnProcess(0));

    const result = await mergeChapters(chapters, {
      title: 'Book',
      author: 'Author',
      outputPath,
    });

    expect(result.success).toBe(true);
    expect(result.chapterCount).toBe(2);
    expect(result.totalDuration).toBe(120000);
    expect(spawnMock).toHaveBeenCalled();
  });

  it('parses probe metadata including track numbers', async () => {
    mockExecImplementation(() => ({
      stdout: JSON.stringify({
        format: {
          duration: '90',
          bit_rate: '256000',
          tags: { track: '1/10', title: 'Chapter One' },
        },
      }),
    }));

    const probe = await probeAudioFile('/tmp/chapter.mp3');

    expect(probe.duration).toBe(90000);
    expect(probe.bitrate).toBe(256);
    expect(probe.trackNumber).toBe(1);
    expect(probe.title).toBe('Chapter One');
  });

  it('returns failure when ffmpeg merge fails', async () => {
    const chapters = [
      { path: '/tmp/one.mp3', filename: 'one.mp3', duration: 60000, bitrate: 128, chapterTitle: 'One' },
    ];
    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue({ size: 500 * 1024 });
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    mockExecImplementation((command) => {
      if (command.startsWith('ffmpeg -encoders')) {
        return { stdout: 'aac encoder' };
      }
      return { stdout: '' };
    });

    spawnMock.mockReturnValue(createSpawnProcess(1, 'Error: merge failed'));

    const result = await mergeChapters(chapters, {
      title: 'Book',
      author: 'Author',
      outputPath: '/tmp/output.m4b',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/FFmpeg merge failed/i);
  });

  it('returns failure when output validation fails', async () => {
    const outputPath = '/tmp/output.m4b';
    const chapters = [
      { path: '/tmp/one.m4a', filename: 'one.m4a', duration: 60000, bitrate: 128, chapterTitle: 'One' },
      { path: '/tmp/two.m4a', filename: 'two.m4a', duration: 60000, bitrate: 128, chapterTitle: 'Two' },
    ];

    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockImplementation(async (filePath: string) => {
      if (filePath === outputPath) {
        return { size: 2 * 1024 * 1024 };
      }
      return { size: 500 * 1024 };
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    mockExecImplementation((command) => {
      if (command.startsWith('ffprobe')) {
        return {
          stdout: JSON.stringify({
            format: {
              duration: '30',
              bit_rate: '128000',
              tags: {},
            },
          }),
        };
      }
      return { stdout: '' };
    });

    spawnMock.mockReturnValue(createSpawnProcess(0));

    const result = await mergeChapters(chapters, {
      title: 'Book',
      author: 'Author',
      outputPath,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Merge validation failed/i);
  });

  it('returns failure when file integrity validation fails', async () => {
    const outputPath = '/tmp/output.m4b';
    const chapters = [
      { path: '/tmp/one.m4a', filename: 'one.m4a', duration: 60000, bitrate: 128, chapterTitle: 'One' },
      { path: '/tmp/two.m4a', filename: 'two.m4a', duration: 60000, bitrate: 128, chapterTitle: 'Two' },
    ];

    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue({ size: 500 * 1024 });
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    mockExecImplementation((command) => {
      if (command.startsWith('ffprobe')) {
        return {
          stdout: JSON.stringify({
            format: {
              duration: '120',
              bit_rate: '128000',
              tags: {},
            },
          }),
        };
      }
      if (command.startsWith('ffmpeg -v error')) {
        return { error: new Error('decode failed') };
      }
      return { stdout: '' };
    });

    spawnMock.mockReturnValue(createSpawnProcess(0));

    const result = await mergeChapters(chapters, {
      title: 'Book',
      author: 'Author',
      outputPath,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/File integrity test failed/i);
  });

  it('returns failure when merged file size is too small', async () => {
    const outputPath = '/tmp/output.m4b';
    const chapters = [
      { path: '/tmp/one.m4a', filename: 'one.m4a', duration: 60000, bitrate: 128, chapterTitle: 'One' },
      { path: '/tmp/two.m4a', filename: 'two.m4a', duration: 60000, bitrate: 128, chapterTitle: 'Two' },
    ];

    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockImplementation(async (filePath: string) => {
      if (filePath === outputPath) {
        return { size: 200 * 1024 };
      }
      return { size: 500 * 1024 };
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    mockExecImplementation((command) => {
      if (command.startsWith('ffprobe')) {
        return {
          stdout: JSON.stringify({
            format: {
              duration: '120',
              bit_rate: '128000',
              tags: {},
            },
          }),
        };
      }
      if (command.startsWith('ffmpeg -v error')) {
        return { stdout: '' };
      }
      return { stdout: '' };
    });

    spawnMock.mockReturnValue(createSpawnProcess(0));

    const result = await mergeChapters(chapters, {
      title: 'Book',
      author: 'Author',
      outputPath,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/File size too small/i);
  });

  it('returns failure when validation encounters an error', async () => {
    const outputPath = '/tmp/output.m4b';
    const chapters = [
      { path: '/tmp/one.m4a', filename: 'one.m4a', duration: 60000, bitrate: 128, chapterTitle: 'One' },
    ];

    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockResolvedValue({ size: 500 * 1024 });
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    mockExecImplementation((command) => {
      if (command.startsWith('ffprobe')) {
        return { error: new Error('probe failed') };
      }
      return { stdout: '' };
    });

    spawnMock.mockReturnValue(createSpawnProcess(0));

    const result = await mergeChapters(chapters, {
      title: 'Book',
      author: 'Author',
      outputPath,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Validation error/i);
  });

  it('logs encoding estimates for long MP3 audiobooks', async () => {
    const outputPath = '/tmp/output.m4b';
    const chapters = [
      { path: '/tmp/one.mp3', filename: 'one.mp3', duration: 3600000, bitrate: 128, chapterTitle: 'One' },
      { path: '/tmp/two.mp3', filename: 'two.mp3', duration: 3600000, bitrate: 128, chapterTitle: 'Two' },
    ];
    const logger = {
      info: vi.fn().mockResolvedValue(undefined),
      warn: vi.fn().mockResolvedValue(undefined),
      error: vi.fn().mockResolvedValue(undefined),
    };

    fsMock.access.mockResolvedValue(undefined);
    fsMock.stat.mockImplementation(async (filePath: string) => {
      if (filePath === outputPath) {
        return { size: 120 * 1024 * 1024 };
      }
      return { size: 500 * 1024 };
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    mockExecImplementation((command) => {
      if (command.startsWith('ffmpeg -encoders')) {
        return { stdout: 'libfdk_aac' };
      }
      if (command.startsWith('ffprobe')) {
        return {
          stdout: JSON.stringify({
            format: {
              duration: '7200',
              bit_rate: '128000',
              tags: {},
            },
          }),
        };
      }
      if (command.startsWith('ffmpeg -v error')) {
        return { stdout: '' };
      }
      return { stdout: '' };
    });

    spawnMock.mockReturnValue(createSpawnProcess(0));

    const result = await mergeChapters(chapters, {
      title: 'Book',
      author: 'Author',
      outputPath,
    }, logger);

    expect(result.success).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('long audiobook'));
  });

  it('returns failure when output file is not created', async () => {
    const outputPath = '/tmp/output.m4b';
    const chapters = [
      { path: '/tmp/one.m4a', filename: 'one.m4a', duration: 60000, bitrate: 128, chapterTitle: 'One' },
    ];

    fsMock.access.mockImplementation(async (filePath: string) => {
      if (filePath === outputPath) {
        throw new Error('missing');
      }
      return undefined;
    });
    fsMock.stat.mockResolvedValue({ size: 500 * 1024 });
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    mockExecImplementation(() => ({ stdout: '' }));
    spawnMock.mockReturnValue(createSpawnProcess(0));

    const result = await mergeChapters(chapters, {
      title: 'Book',
      author: 'Author',
      outputPath,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Merged file not created/i);
  });

  describe('metadata escaping', () => {
    it('does NOT escape single quotes in metadata (they are literal in double-quoted shell strings)', async () => {
      const outputPath = '/tmp/output.m4b';
      const chapters = [
        { path: '/tmp/one.m4a', filename: 'one.m4a', duration: 60000, bitrate: 128, chapterTitle: 'One' },
      ];

      fsMock.access.mockResolvedValue(undefined);
      fsMock.stat.mockImplementation(async (filePath: string) => {
        if (filePath === outputPath) {
          return { size: 2 * 1024 * 1024 };
        }
        return { size: 500 * 1024 };
      });
      fsMock.mkdir.mockResolvedValue(undefined);
      fsMock.writeFile.mockResolvedValue(undefined);
      fsMock.unlink.mockResolvedValue(undefined);

      mockExecImplementation((command) => {
        if (command.startsWith('ffprobe')) {
          return {
            stdout: JSON.stringify({
              format: { duration: '60', bit_rate: '128000', tags: {} },
            }),
          };
        }
        if (command.startsWith('ffmpeg -v error')) {
          return { stdout: '' };
        }
        return { stdout: '' };
      });

      spawnMock.mockReturnValue(createSpawnProcess(0));

      await mergeChapters(chapters, {
        title: "It's Not Her",
        author: "O'Brien",
        narrator: "Jane's Voice",
        outputPath,
      });

      // Get the args passed to spawn
      const spawnCall = spawnMock.mock.calls[0];
      const args = spawnCall[1] as string[];

      // Find the title metadata arg (format after parsing: title="It's Not Her)
      const titleArg = args.find((arg: string) => arg.startsWith('title='));
      const albumArtistArg = args.find((arg: string) => arg.startsWith('album_artist='));
      const composerArg = args.find((arg: string) => arg.startsWith('composer='));

      // Single quotes should appear as-is ('s), NOT escaped with backslash (\'s)
      // The args contain the value with opening quote: title="It's Not Her
      expect(titleArg).toContain("It's Not Her");
      expect(titleArg).not.toContain("\\'"); // No escaped single quotes
      expect(albumArtistArg).toContain("O'Brien");
      expect(albumArtistArg).not.toContain("\\'");
      expect(composerArg).toContain("Jane's Voice");
      expect(composerArg).not.toContain("\\'");

      // Verify no backslash-escaped single quotes anywhere in args
      const allArgsJoined = args.join(' ');
      expect(allArgsJoined).not.toContain("\\'");
    });

    it('properly escapes double quotes and special shell characters', async () => {
      const outputPath = '/tmp/output.m4b';
      const chapters = [
        { path: '/tmp/one.m4a', filename: 'one.m4a', duration: 60000, bitrate: 128, chapterTitle: 'One' },
      ];

      fsMock.access.mockResolvedValue(undefined);
      fsMock.stat.mockImplementation(async (filePath: string) => {
        if (filePath === outputPath) {
          return { size: 2 * 1024 * 1024 };
        }
        return { size: 500 * 1024 };
      });
      fsMock.mkdir.mockResolvedValue(undefined);
      fsMock.writeFile.mockResolvedValue(undefined);
      fsMock.unlink.mockResolvedValue(undefined);

      mockExecImplementation((command) => {
        if (command.startsWith('ffprobe')) {
          return {
            stdout: JSON.stringify({
              format: { duration: '60', bit_rate: '128000', tags: {} },
            }),
          };
        }
        if (command.startsWith('ffmpeg -v error')) {
          return { stdout: '' };
        }
        return { stdout: '' };
      });

      spawnMock.mockReturnValue(createSpawnProcess(0));

      await mergeChapters(chapters, {
        title: 'Book "Quoted" $100',
        author: 'Author',
        outputPath,
      });

      // Get the args passed to spawn
      const spawnCall = spawnMock.mock.calls[0];
      const args = spawnCall[1] as string[];

      // Find the title arg - double quotes and $ should be escaped
      const titleArg = args.find((arg: string) => arg.startsWith('title='));

      // Verify escaping is present for double quotes and dollar signs
      expect(titleArg).toContain('\\"Quoted\\"');
      expect(titleArg).toContain('\\$100');
    });
  });
});
