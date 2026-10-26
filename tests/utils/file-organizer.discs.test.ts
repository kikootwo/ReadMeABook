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
  analyzeChapterFiles: vi.fn(async (files: string[]) =>
    files.map((p) => ({ path: p, filename: path.basename(p), duration: 30000, chapterTitle: 'Chapter' }))
  ),
  mergeChapters: vi.fn(async (_chapters: unknown, options: { outputPath: string }) => {
    const nodeFs = await import('fs');
    nodeFs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    nodeFs.writeFileSync(options.outputPath, 'merged-m4b');
    return { success: true, outputPath: options.outputPath, durationVerified: true };
  }),
  probeAudioFile: vi.fn(async (filePath: string) => ({ duration: 1000, trackNumber: tracks.get(path.basename(filePath)) })),
}));

import { analyzeChapterFiles } from '@/lib/utils/chapter-merger';
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
});

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
