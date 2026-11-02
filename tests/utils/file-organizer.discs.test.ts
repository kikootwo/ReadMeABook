/**
 * Component: File Organization, multi-disc sources (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 *
 * The real organizer on real temp folders: disc-by-disc order for the copy,
 * the rename numbering and the merge, and the in-place stop for Manual/Bulk
 * Import. Tagging, merging and probing are replaced so they can be observed.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configState = vi.hoisted(() => ({ values: new Map<string, string>() }));
const tracks = vi.hoisted(() => new Map<string, number>());

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

vi.mock('@/lib/utils/metadata-tagger', async (importOriginal) => ({
  buildMp4FreeformTags: (await importOriginal<typeof import('@/lib/utils/metadata-tagger')>()).buildMp4FreeformTags,
  checkFfmpegAvailable: vi.fn(async () => true),
  addMp4FreeformTags: vi.fn(async () => ({ written: false })),
  tagMultipleFiles: vi.fn(async (files: string[]) => {
    const nodeFs = await import('fs');
    return files.map((filePath) => {
      nodeFs.writeFileSync(`${filePath}.tmp`, nodeFs.readFileSync(filePath));
      return { success: true, filePath, taggedFilePath: `${filePath}.tmp` };
    });
  }),
}));

vi.mock('@/lib/utils/audio-duration', () => ({ probeStreamDurationMs: vi.fn(async () => 60000) }));

vi.mock('@/lib/utils/chapter-merger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/chapter-merger')>()),
  detectChapterFiles: vi.fn(async () => true),
  estimateOutputSize: vi.fn(async () => 1),
  checkDiskSpace: vi.fn(async () => null),
  // The merger's own rule without a given order: track tags when every file has one and they run 1..N, else names
  analyzeChapterFiles: vi.fn(async (files: string[], _logger?: unknown, keepOrder?: boolean) => {
    const chapters = files.map((p) => ({ path: p, filename: path.basename(p), duration: 30000, chapterTitle: 'Chapter' }));
    if (keepOrder) return chapters;
    const byTags = [...chapters].sort((a, b) => (tracks.get(a.filename) ?? 0) - (tracks.get(b.filename) ?? 0));
    if (byTags.every((c, i) => tracks.get(c.filename) === i + 1)) return byTags;
    return [...chapters].sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
  }),
  mergeChapters: vi.fn(async (_chapters: unknown, options: { outputPath: string }) => {
    const nodeFs = await import('fs');
    nodeFs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    nodeFs.writeFileSync(options.outputPath, 'merged-m4b');
    return { success: true, outputPath: options.outputPath, durationVerified: true };
  }),
  probeAudioFile: vi.fn(async (filePath: string) => ({ duration: 1000, trackNumber: tracks.get(path.basename(filePath)) })),
}));

import { analyzeChapterFiles, mergeChapters } from '@/lib/utils/chapter-merger';
import { tagMultipleFiles } from '@/lib/utils/metadata-tagger';
import { FileOrganizer } from '@/lib/utils/file-organizer';

let root: string;
let media: string;

function write(file: string, data = 'audio'): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}

function listAll(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

const tmpDir = () => path.join(root, 'tmp');

async function organize(source: string, opts: { selected?: string[]; rename?: boolean; stop?: boolean; template?: string } = {}) {
  const organizer = new FileOrganizer(media, tmpDir());
  return organizer.organize(
    source,
    { title: 'Book', author: 'Author' },
    opts.template ?? '{author}/{title}',
    undefined,
    opts.rename ? { enabled: true, template: '{title}' } : undefined,
    opts.selected,
    { stopInPlaceDiscLayout: opts.stop }
  );
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-org-discs-')));
  media = path.join(root, 'media');
  configState.values.clear();
  configState.values.set('metadata_tagging_enabled', 'false');
  tracks.clear();
  vi.mocked(analyzeChapterFiles).mockClear();
  vi.mocked(mergeChapters).mockClear();
  vi.mocked(tagMultipleFiles).mockClear();
});

const rel = (source: string, files: string[]) => files.map((f) => path.relative(source, f).split(path.sep).join('/'));

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('multi-disc order', () => {
  it('rename numbering follows disc number (Disc 2 before Disc 10), selected with / entries', async () => {
    const source = path.join(root, 'downloads', 'Book');
    const selected: string[] = [];
    for (const d of [1, 2, 10]) {
      write(path.join(source, `Disc ${d}`, '01.mp3'), `disc${d}`);
      selected.push(`Disc ${d}/01.mp3`);
    }
    write(path.join(source, 'Extras', 'x.mp3'));
    const result = await organize(source, { selected: [...selected].reverse(), rename: true });
    expect(result.success).toBe(true);
    const target = path.join(media, 'Author', 'Book');
    const read = (n: number) => fs.readFileSync(path.join(target, `Book - ${n}.mp3`), 'utf8');
    expect([read(1), read(2), read(3)]).toEqual(['disc1', 'disc2', 'disc10']);
    expect(listAll(target)).toEqual(['Book - 1.mp3', 'Book - 2.mp3', 'Book - 3.mp3']);
  });

  it('the merge is given disc-by-disc order (per-disc track tags) and keeps it', async () => {
    configState.values.set('chapter_merging_enabled', 'true');
    const source = path.join(root, 'downloads', 'Book');
    for (const f of ['CD1/a.mp3', 'CD1/b.mp3', 'CD2/c.mp3', 'CD2/d.mp3']) write(path.join(source, f));
    tracks.set('a.mp3', 2).set('b.mp3', 1).set('c.mp3', 1).set('d.mp3', 2);
    const result = await organize(source);
    expect(result.success).toBe(true);
    const [files, , keepOrder] = vi.mocked(analyzeChapterFiles).mock.calls[0];
    expect(files.map((f) => path.relative(source, f).split(path.sep).join('/'))).toEqual(['CD1/b.mp3', 'CD1/a.mp3', 'CD2/c.mp3', 'CD2/d.mp3']);
    expect(keepOrder).toBe(true);
  });

  it('a single folder keeps today\'s merge call (no given order)', async () => {
    configState.values.set('chapter_merging_enabled', 'true');
    const source = path.join(root, 'downloads', 'Book');
    for (const f of ['01.mp3', '02.mp3', '03.mp3']) write(path.join(source, f));
    await organize(source);
    expect(vi.mocked(analyzeChapterFiles).mock.calls[0][2] ?? false).toBe(false);
  });

  it('track tags that run across the discs (CD2 continues CD1) give the merge order, names do not', async () => {
    configState.values.set('chapter_merging_enabled', 'true');
    const source = path.join(root, 'downloads', 'Book');
    // Chapter-title names that do not sort in play order
    const playOrder = ['CD1/Prologue.mp3', 'CD1/A Storm.mp3', 'CD1/Kingdoms.mp3', 'CD2/Exile.mp3', 'CD2/Crowns.mp3', 'CD2/Epilogue.mp3'];
    playOrder.forEach((f, i) => {
      write(path.join(source, f));
      tracks.set(path.basename(f), i + 1);
    });
    expect((await organize(source)).success).toBe(true);
    const chapters = vi.mocked(mergeChapters).mock.calls[0][0] as Array<{ path: string }>;
    expect(rel(source, chapters.map((c) => c.path))).toEqual(playOrder);
  });

  it('a root intro tagged 1 with chapter-title discs tagged 2..N: the merge follows the source tags', async () => {
    configState.values.set('chapter_merging_enabled', 'true');
    const source = path.join(root, 'downloads', 'Book');
    const playOrder = ['Opening.mp3', 'CD1/The Shire.mp3', 'CD1/A Party.mp3', 'CD2/Bree.mp3', 'CD2/Amon Hen.mp3'];
    playOrder.forEach((f, i) => {
      write(path.join(source, f));
      tracks.set(path.basename(f), i + 1);
    });
    expect((await organize(source)).success).toBe(true);
    const chapters = vi.mocked(mergeChapters).mock.calls[0][0] as Array<{ path: string }>;
    expect(rel(source, chapters.map((c) => c.path))).toEqual(playOrder);
  });
});

describe('disc and track tags (tagging on)', () => {
  beforeEach(() => {
    configState.values.set('metadata_tagging_enabled', 'true');
  });

  it('each disc file gets its disc (d/D) and its track across the book (n/N), in import order', async () => {
    const source = path.join(root, 'downloads', 'Book');
    for (const f of ['Intro.mp3', 'Disc 2/01.mp3', 'Disc 1/02.mp3', 'Disc 1/01.mp3']) write(path.join(source, f));
    expect((await organize(source)).success).toBe(true);
    const [files, , positions] = vi.mocked(tagMultipleFiles).mock.calls[0];
    expect(rel(source, files)).toEqual(['Intro.mp3', 'Disc 1/01.mp3', 'Disc 1/02.mp3', 'Disc 2/01.mp3']);
    expect(positions).toEqual([
      { disc: '1/2', track: '1/4' }, { disc: '1/2', track: '2/4' }, { disc: '1/2', track: '3/4' }, { disc: '2/2', track: '4/4' },
    ]);
  });

  it('the written tags follow the source tags: a root intro tagged 1, a root outro tagged N plays last', async () => {
    const source = path.join(root, 'downloads', 'Book');
    const playOrder = ['Opening.mp3', 'CD1/The Shire.mp3', 'CD1/A Party.mp3', 'CD2/Bree.mp3', 'CD2/Amon Hen.mp3', 'Afterword.mp3'];
    playOrder.forEach((f, i) => {
      write(path.join(source, f));
      tracks.set(path.basename(f), i + 1);
    });
    expect((await organize(source)).success).toBe(true);
    const [files, , positions] = vi.mocked(tagMultipleFiles).mock.calls[0];
    expect(rel(source, files)).toEqual(playOrder);
    expect(positions).toEqual([
      { disc: '1/2', track: '1/6' }, { disc: '1/2', track: '2/6' }, { disc: '1/2', track: '3/6' },
      { disc: '2/2', track: '4/6' }, { disc: '2/2', track: '5/6' }, { disc: '2/2', track: '6/6' },
    ]);
  });

  it('a single folder is tagged exactly as before: no disc or track values', async () => {
    const source = path.join(root, 'downloads', 'Book');
    for (const f of ['01.mp3', '02.mp3']) write(path.join(source, f));
    await organize(source);
    expect(vi.mocked(tagMultipleFiles).mock.calls[0]).toHaveLength(2);
  });

  it('a merged multi-disc book: the m4b gets no disc or track values', async () => {
    configState.values.set('chapter_merging_enabled', 'true');
    const source = path.join(root, 'downloads', 'Book');
    for (const f of ['CD1/01.mp3', 'CD2/01.mp3']) write(path.join(source, f));
    await organize(source);
    const [files, , positions] = vi.mocked(tagMultipleFiles).mock.calls[0];
    expect(files.map((f) => path.extname(f))).toEqual(['.m4b']);
    expect(positions).toEqual([undefined]);
  });

  it('tagging off: nothing is tagged', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');
    const source = path.join(root, 'downloads', 'Book');
    for (const f of ['CD1/01.mp3', 'CD2/01.mp3']) write(path.join(source, f));
    await organize(source);
    expect(tagMultipleFiles).not.toHaveBeenCalled();
  });
});

describe('in-place stop (a Manual/Bulk import of the book\'s own library folder)', () => {
  let lib: string;
  beforeEach(() => {
    configState.values.set('metadata_tagging_enabled', 'true');
    configState.values.set('chapter_merging_enabled', 'true');
    lib = path.join(media, 'Author', 'Book');
    for (const f of ['CD1/01.mp3', 'CD1/02.mp3', 'CD2/01.mp3']) write(path.join(lib, f));
  });

  const expectUntouched = (result: Awaited<ReturnType<typeof organize>>) => {
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toMatch(/nothing was changed/);
    expect(listAll(lib)).toEqual(['CD1/01.mp3', 'CD1/02.mp3', 'CD2/01.mp3']);
    expect(listAll(tmpDir())).toEqual([]);
  };

  it('stops before merging, tagging or copying: no .tmp, no temp m4b, no flat copies', async () => {
    expectUntouched(await organize(lib, { stop: true }));
  });

  it.each([
    ['one disc', ['CD1/01.mp3', 'CD1/02.mp3']],
    ['a root file plus one disc', ['Intro.mp3', 'CD2/01.mp3']],
  ])('stops a subset (%s) of the library folder: no .tmp, no temp m4b, no flat copies', async (_label, selected) => {
    write(path.join(lib, 'Intro.mp3'));
    const result = await organize(lib, { stop: true, selected });
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toMatch(/nothing was changed/);
    expect(listAll(lib)).toEqual(['CD1/01.mp3', 'CD1/02.mp3', 'CD2/01.mp3', 'Intro.mp3']);
    expect(listAll(tmpDir())).toEqual([]);
  });

  it('stops for a differently-cased source path (case-insensitive filesystems)', async (ctx) => {
    const upper = path.join(media, 'AUTHOR', 'BOOK');
    if (!fs.existsSync(upper)) ctx.skip();
    expectUntouched(await organize(upper, { stop: true }));
  });

  it('stops for a source named through a symlink', async (ctx) => {
    const link = path.join(root, 'library-link');
    try {
      fs.symlinkSync(lib, link, 'junction');
    } catch {
      ctx.skip();
    }
    expectUntouched(await organize(link, { stop: true }));
  });

  it('a download (no stop requested) keeps today\'s path', async () => {
    configState.values.set('metadata_tagging_enabled', 'false');
    configState.values.set('chapter_merging_enabled', 'false');
    const result = await organize(lib);
    expect(result.success).toBe(true);
  });
});
