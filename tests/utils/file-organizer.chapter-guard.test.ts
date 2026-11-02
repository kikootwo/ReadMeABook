/**
 * Component: Tagged Copy Chapter Guard Tests (#511, real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 *
 * The real organizer on real temp folders. Tagging writes a `.tmp` copy, and
 * ffprobe's `-show_chapters` output is scripted per file, so a tagged copy
 * whose chapter table changed can be driven through the whole import.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Table = Array<[title: string, start: number, end: number]>;
const chapterState = vi.hoisted(() => ({
  source: [] as Table | Error,
  tagged: [] as Table | Error,
  /** Every ffprobe -show_chapters call and freeform step, in order. */
  calls: [] as string[],
  argv: [] as Array<{ args: string[]; options: Record<string, unknown> }>,
}));
const configState = vi.hoisted(() => ({ values: new Map<string, string>() }));
const logState = vi.hoisted(() => ({ warn: [] as string[] }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const { promisify } = await import('util');
  const realExecFile = promisify(actual.execFile);
  const scripted = async (cmd: string, args: string[], options: Record<string, unknown>) => {
    if (cmd !== 'ffprobe' || !args.includes('-show_chapters')) return realExecFile(cmd, args, options);
    const file = args[args.length - 1];
    chapterState.calls.push(`chapters:${path.basename(file)}`);
    chapterState.argv.push({ args, options });
    const table = file.endsWith('.tmp') ? chapterState.tagged : chapterState.source;
    if (table instanceof Error) throw Object.assign(table, { stderr: `${table.message}\n` });
    const chapters = table.map(([title, start, end], id) => ({
      id, time_base: '1/1000', start_time: start.toFixed(6), end_time: end.toFixed(6), tags: { title },
    }));
    return { stdout: JSON.stringify({ chapters }), stderr: '' };
  };
  const execFile = Object.assign((...args: unknown[]) => (actual.execFile as (...a: unknown[]) => unknown)(...args), {
    [promisify.custom]: scripted,
  });
  return { ...actual, default: { ...actual, execFile }, execFile };
});

vi.mock('@/lib/db', () => ({
  prisma: {
    configuration: {
      findUnique: vi.fn(async ({ where: { key } }: { where: { key: string } }) => {
        const value = configState.values.get(key);
        return value !== undefined ? { value } : null;
      }),
    },
  },
}));

vi.mock('@/lib/utils/logger', () => {
  const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const job = {
    info: vi.fn(async () => undefined),
    warn: vi.fn(async (message: string) => { logState.warn.push(message); }),
    error: vi.fn(async () => undefined),
    debug: vi.fn(),
  };
  return { RMABLogger: { create: vi.fn(() => quiet), forJob: vi.fn(() => job) } };
});

vi.mock('@/lib/utils/metadata-tagger', async (importOriginal) => ({
  buildMp4FreeformTags: (await importOriginal<typeof import('@/lib/utils/metadata-tagger')>()).buildMp4FreeformTags,
  checkFfmpegAvailable: vi.fn(async () => true),
  addMp4FreeformTags: vi.fn(async (file: string) => {
    chapterState.calls.push(`freeform:${path.basename(file)}`);
    return { written: false };
  }),
  tagMultipleFiles: vi.fn(async (files: string[]) => {
    const nodeFs = await import('fs');
    return files.map((filePath) => {
      const taggedFilePath = `${filePath}.tmp`;
      nodeFs.writeFileSync(taggedFilePath, Buffer.concat([Buffer.from('TAGS'), nodeFs.readFileSync(filePath)]));
      return { success: true, filePath, taggedFilePath };
    });
  }),
}));

vi.mock('@/lib/utils/audio-duration', () => ({ probeStreamDurationMs: vi.fn(async () => 3_000_000) }));

import { FileOrganizer } from '@/lib/utils/file-organizer';

/** The cover + 4 chapter source from the #511 repro, and what ffmpeg 9.0.2's tagging remux made of it. */
const SOURCE: Table = [['001', 0, 20.571995], ['002', 20.571995, 1533.351995], ['003', 1533.351995, 2500], ['004', 2500, 3000]];
const ZERO_LENGTH: Table = [['001', 0, 20.571995], ['002', 20.571995, 20.571995], ['003', 1533.351995, 1533.351995], ['004', 2500, 2500]];

let root: string;
let media: string;
let source: string;

async function organize() {
  const organizer = new FileOrganizer(media, path.join(root, 'tmp'));
  return organizer.organize(source, { title: 'Book', author: 'Author' }, '{author}/{title}', { jobId: 'job-511', context: 'test' },
    undefined, undefined, { compareExisting: true, metadataTaggingEnabled: true });
}

const placed = () => fs.readFileSync(path.join(media, 'Author', 'Book', 'Book.m4b'), 'utf8');
const leftovers = () => fs.readdirSync(source).filter((f) => f.endsWith('.tmp'));

describe('FileOrganizer tagged copy chapter guard (#511)', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-511-')));
    media = path.join(root, 'media');
    source = path.join(root, 'downloads', 'Book');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'Book.m4b'), 'original-bytes');
    chapterState.source = SOURCE;
    chapterState.tagged = SOURCE;
    chapterState.calls = [];
    chapterState.argv = [];
    configState.values.clear();
    logState.warn = [];
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ['zero-length chapters (the ffmpeg 9.0.2 cover + chapters remux)', ZERO_LENGTH, '4 chapters before, 4 after, first change at chapter 2'],
    ['a missing chapter', SOURCE.slice(0, 3), '4 chapters before, 3 after, first change at chapter 4'],
    ['reordered chapters', [SOURCE[0], SOURCE[2], SOURCE[1], SOURCE[3]], '4 chapters before, 4 after, first change at chapter 2'],
    ['a renamed chapter', [SOURCE[0], ['Chapter 2', 20.571995, 1533.351995], SOURCE[2], SOURCE[3]], '4 chapters before, 4 after, first change at chapter 2'],
    ['a chapter start moved by more than 0.1 s', [SOURCE[0], ['002', 20.7, 1533.351995], SOURCE[2], SOURCE[3]], '4 chapters before, 4 after, first change at chapter 2'],
  ] as Array<[string, Table, string]>)('discards a tagged copy with %s and imports the original untagged', async (_label, tagged, counts) => {
    chapterState.tagged = tagged;

    const result = await organize();

    expect(result.success).toBe(true);
    expect(placed()).toBe('original-bytes');
    expect(result.records![0]).toMatchObject({ status: 'copied', verified: true, tagsDropped: 'tagging changed the chapter table' });
    expect(logState.warn).toEqual([
      `Tagging changed the chapter table of Book.m4b (${counts}), so it was imported without tags`,
    ]);
    expect(leftovers()).toEqual([]);
  });

  it('keeps the tagged copy when its chapters match the source within 0.1 s', async () => {
    chapterState.tagged = SOURCE.map(([title, start, end]) => [title, start + 0.05, end - 0.05]);

    const result = await organize();

    expect(placed()).toBe('TAGSoriginal-bytes');
    expect(result.records![0].tagsDropped).toBeUndefined();
    expect(logState.warn).toEqual([]);
    expect(leftovers()).toEqual([]);
  });

  it('skips the check when the source has no chapters (the tagged copy is not probed)', async () => {
    chapterState.source = [];
    chapterState.tagged = new Error('must not be probed');

    const result = await organize();

    expect(placed()).toBe('TAGSoriginal-bytes');
    expect(result.records![0].tagsDropped).toBeUndefined();
    expect(chapterState.calls.filter((c) => c.startsWith('chapters:'))).toEqual(['chapters:Book.m4b']);
    expect(logState.warn).toEqual([]);
  });

  it('treats an ffprobe failure on the tagged copy as a changed table', async () => {
    chapterState.tagged = new Error('moov atom not found');

    const result = await organize();

    expect(placed()).toBe('original-bytes');
    expect(result.records![0]).toMatchObject({ status: 'copied', tagsDropped: 'tagging changed the chapter table' });
    expect(logState.warn).toEqual([
      "Tagging changed the chapter table of Book.m4b (4 chapters before, the tagged copy's could not be read: moov atom not found), so it was imported without tags",
    ]);
    expect(leftovers()).toEqual([]);
  });

  it('keeps the tagged copy and logs it when ffprobe fails on the source', async () => {
    chapterState.source = new Error('Invalid data found when processing input');

    const result = await organize();

    expect(placed()).toBe('TAGSoriginal-bytes');
    expect(result.records![0].tagsDropped).toBeUndefined();
    expect(logState.warn).toEqual([
      'Could not read the chapter table of Book.m4b (Invalid data found when processing input); the tagged copy is used without a chapter check',
    ]);
  });

  it('checks the final tagged file, after the MP4 freeform step, with ffprobe argv and a timeout', async () => {
    await organize();

    expect(chapterState.calls).toEqual(['freeform:Book.m4b.tmp', 'chapters:Book.m4b', 'chapters:Book.m4b.tmp']);
    for (const { args, options } of chapterState.argv) {
      expect(args.slice(0, -1)).toEqual(['-v', 'error', '-show_chapters', '-of', 'json']);
      expect(options).toMatchObject({ timeout: expect.any(Number) });
      expect(options.shell).toBeUndefined();
    }
  });
});
