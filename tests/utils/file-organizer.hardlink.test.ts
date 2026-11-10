/**
 * Component: File Organization Hard Link Placement Tests (real filesystem)
 * Documentation: documentation/features/library-placement.md
 *
 * The real organizer linking into real temp folders. A linked book is the download
 * itself: never tagged, merged or chmod-ed, whatever is passed or stored.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configState = vi.hoisted(() => ({ values: new Map<string, string>() }));
const fsState = vi.hoisted(() => ({
  chmodCalls: [] as string[],
  linkCalls: [] as Array<{ source: string; target: string; opfThere: boolean }>,
  failLinksFrom: null as null | { dir: string; code: string },
  failLinkNamed: null as null | { name: string; code: string },
  fakeSymlinks: new Set<string>(),
}));
const placeState = vi.hoisted(() => ({ audioCalls: [] as unknown[][] }));
const opfState = vi.hoisted(() => ({ failWrite: null as null | string, once: false }));
const rootsState = vi.hoisted(() => ({ roots: null as null | { mediaDir: string; downloadRoots: string[]; otherRoots: string[] } }));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const nodeFs = await import('fs');
  const nodePath = await import('path');
  const chmod = (async (p: unknown, mode: unknown) => {
    fsState.chmodCalls.push(String(p));
    return (actual.chmod as (...a: unknown[]) => unknown)(p, mode);
  }) as typeof actual.chmod;
  const link = (async (source: unknown, target: unknown) => {
    const src = String(source);
    fsState.linkCalls.push({ source: src, target: String(target), opfThere: nodeFs.existsSync(nodePath.join(nodePath.dirname(String(target)), 'metadata.opf')) });
    const fail = fsState.failLinksFrom;
    if (fail && src.startsWith(fail.dir)) throw Object.assign(new Error(`${fail.code}: injected`), { code: fail.code });
    const named = fsState.failLinkNamed;
    if (named && nodePath.basename(src) === named.name) throw Object.assign(new Error(`${named.code}: injected`), { code: named.code });
    return actual.link(source as string, target as string);
  }) as typeof actual.link;
  const lstat = (async (p: unknown, options?: unknown) => {
    const result = await (actual.lstat as (...a: unknown[]) => Promise<object>)(p, options);
    if (!fsState.fakeSymlinks.has(nodePath.resolve(String(p)))) return result;
    return Object.assign(Object.create(Object.getPrototypeOf(result)), result, { isSymbolicLink: () => true, isFile: () => false });
  }) as typeof actual.lstat;
  return { ...actual, default: { ...actual, chmod, link, lstat }, chmod, link, lstat };
});

// Every placeAudio call (the copy loop), to pin that a copy fallback is Copy mode
vi.mock('@/lib/utils/organize-copy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/organize-copy')>();
  const placeAudio = (async (...args: Parameters<typeof actual.placeAudio>) => {
    placeState.audioCalls.push(args);
    return actual.placeAudio(...args);
  }) as typeof actual.placeAudio;
  return { ...actual, placeAudio };
});

vi.mock('@/lib/utils/opf-sidecar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/opf-sidecar')>();
  const writeOpfSidecar = (async (...args: Parameters<typeof actual.writeOpfSidecar>) => {
    const code = opfState.failWrite;
    if (opfState.once) opfState.failWrite = null;
    if (code) throw Object.assign(new Error(`${code}: injected`), { code });
    return actual.writeOpfSidecar(...args);
  }) as typeof actual.writeOpfSidecar;
  return { ...actual, writeOpfSidecar };
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

vi.mock('@/lib/processors/organize-cleanup-guard', () => ({
  collectGuardRoots: vi.fn(async () => ({ ...rootsState.roots!, sweepRoots: [], mappedRoots: [] })),
}));

vi.mock('@/lib/utils/metadata-tagger', async (importOriginal) => ({
  buildMp4FreeformTags: (await importOriginal<typeof import('@/lib/utils/metadata-tagger')>()).buildMp4FreeformTags,
  checkFfmpegAvailable: vi.fn(async () => true),
  addMp4FreeformTags: vi.fn(async () => ({ written: false })),
  tagMultipleFiles: vi.fn(async (files: string[]) => files.map((filePath) => ({ success: false, filePath, error: 'not expected' }))),
}));

vi.mock('@/lib/utils/audio-duration', () => ({ probeStreamDurationMs: vi.fn(async () => 60000) }));

vi.mock('@/lib/utils/chapter-merger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/chapter-merger')>();
  return { ...actual, detectChapterFiles: vi.fn(async () => true), mergeChapters: vi.fn(), analyzeChapterFiles: vi.fn() };
});

import { FileOrganizer, type PlacementOptions } from '@/lib/utils/file-organizer';
import { tagMultipleFiles, addMp4FreeformTags } from '@/lib/utils/metadata-tagger';
import { detectChapterFiles, mergeChapters } from '@/lib/utils/chapter-merger';

let root: string;
let media: string;
let downloads: string;
let source: string;
let book: string;

const write = (file: string, data: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
};
const ino = (p: string) => fs.statSync(p, { bigint: true }).ino;

async function organize(placement: PlacementOptions, from = source) {
  const organizer = new FileOrganizer(media, path.join(root, 'tmp'), 0o600);
  return organizer.organize(
    from,
    { title: 'Book', author: 'Ann Writer, Ben Co-Writer', narrator: 'Cara Reader', asin: 'B000000001' },
    '{author}/{title}', undefined, undefined, undefined, placement
  );
}

describe('FileOrganizer hard link placement', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-hardlink-')));
    media = path.join(root, 'media');
    downloads = path.join(root, 'downloads');
    source = path.join(downloads, 'Book.Name');
    book = path.join(media, 'Ann Writer, Ben Co-Writer', 'Book');
    fs.mkdirSync(media, { recursive: true });
    rootsState.roots = { mediaDir: media, downloadRoots: [downloads], otherRoots: [] };
    configState.values.clear();
    configState.values.set('chapter_merging_enabled', 'true');
    configState.values.set('metadata_tagging_enabled', 'true');
    fsState.chmodCalls = [];
    fsState.linkCalls = [];
    fsState.failLinksFrom = null;
    fsState.failLinkNamed = null;
    fsState.fakeSymlinks.clear();
    placeState.audioCalls = [];
    opfState.failWrite = null;
    opfState.once = false;
    vi.mocked(tagMultipleFiles).mockClear();
    vi.mocked(addMp4FreeformTags).mockClear();
    vi.mocked(detectChapterFiles).mockClear();
    vi.mocked(mergeChapters).mockClear();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('links the audio, never tags, merges or chmods it, copies the cover and writes the OPF first', async () => {
    const a = write(path.join(source, 'Part 1.mp3'), 'one');
    const b = write(path.join(source, 'Part 2.mp3'), 'two');
    const cover = write(path.join(source, 'cover.jpg'), 'cover-bytes');

    // Tagging passed on and merge stored on: both ignored for a linked book
    const result = await organize({ filePlacement: 'hardlink', writeOpf: true, metadataTaggingEnabled: true });

    expect(result.success).toBe(true);
    expect(result.linkedCount).toBe(2);
    expect(result.linkFallback).toBeUndefined();
    expect(result.records!.map((r) => [path.basename(r.source), r.status, r.verified, r.linked]).sort()).toEqual(
      [['Part 1.mp3', 'copied', true, true], ['Part 2.mp3', 'copied', true, true]]
    );
    expect(ino(path.join(book, 'Part 1.mp3'))).toBe(ino(a));
    expect(ino(path.join(book, 'Part 2.mp3'))).toBe(ino(b));
    expect(fs.statSync(a).nlink).toBe(2);
    expect(tagMultipleFiles).not.toHaveBeenCalled();
    expect(addMp4FreeformTags).not.toHaveBeenCalled();
    expect(detectChapterFiles).not.toHaveBeenCalled();
    expect(mergeChapters).not.toHaveBeenCalled();
    // chmod only on files RMAB wrote: the OPF and the cover copy, never a linked audio name
    expect(fsState.chmodCalls.map((p) => path.basename(p)).sort()).toEqual(['cover.jpg', 'metadata.opf']);
    expect(ino(path.join(book, 'cover.jpg'))).not.toBe(ino(cover));
    // metadata.opf was in the folder before the first audio link
    const audioLinks = fsState.linkCalls.filter((c) => c.source.startsWith(source) && c.source.endsWith('.mp3'));
    expect(audioLinks[0].opfThere).toBe(true);
    expect(fs.readFileSync(path.join(book, 'metadata.opf'), 'utf8')).toContain('<dc:creator opf:role="aut">Ben Co-Writer</dc:creator>');
    expect(fs.readdirSync(book).sort()).toEqual(['Part 1.mp3', 'Part 2.mp3', 'cover.jpg', 'metadata.opf']);
  });

  it('Hard link (copy if not possible): EXDEV copies the whole book untagged, with the reason', async () => {
    const a = write(path.join(source, 'Part 1.mp3'), 'one');
    write(path.join(source, 'Part 2.mp3'), 'two');
    fsState.failLinksFrom = { dir: source, code: 'EXDEV' };

    const result = await organize({ filePlacement: 'hardlink', writeOpf: true, metadataTaggingEnabled: true });

    expect(result.success).toBe(true);
    expect(result.linkFallback).toMatchObject({ code: 'EXDEV' });
    expect(result.records!.every((r) => r.status === 'copied' && r.verified && !r.linked)).toBe(true);
    expect(ino(path.join(book, 'Part 1.mp3'))).not.toBe(ino(a));
    expect(fs.readFileSync(path.join(book, 'Part 1.mp3'), 'utf8')).toBe('one');
    expect(fs.statSync(a).nlink).toBe(1);
    expect(tagMultipleFiles).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(book, 'metadata.opf'))).toBe(true);
  });

  it('Hard link only: imports nothing, removes its own OPF and the folder it created', async () => {
    const a = write(path.join(source, 'Part 1.mp3'), 'one');
    write(path.join(source, 'cover.jpg'), 'cover');
    fsState.failLinksFrom = { dir: source, code: 'EXDEV' };

    const result = await organize({ filePlacement: 'hardlink_only', writeOpf: true });

    expect(result.success).toBe(false);
    expect(result.linkRefused).toMatchObject({ code: 'EXDEV' });
    expect(result.audioFiles).toEqual([]);
    expect(fs.existsSync(book)).toBe(false);
    expect(fs.existsSync(path.join(media, 'Ann Writer, Ben Co-Writer'))).toBe(false);
    expect(fs.readdirSync(media)).toEqual([]);
    expect(fs.readFileSync(a, 'utf8')).toBe('one');
  });

  it('Hard link only keeps a book folder that was already there', async () => {
    write(path.join(source, 'Part 1.mp3'), 'one');
    fs.mkdirSync(book, { recursive: true });
    fsState.failLinksFrom = { dir: source, code: 'EPERM' };

    const result = await organize({ filePlacement: 'hardlink_only', writeOpf: true });

    expect(result.linkRefused).toMatchObject({ code: 'EPERM' });
    expect(fs.existsSync(book)).toBe(true);
    expect(fs.readdirSync(book)).toEqual([]);
  });

  it('a re-import of a linked book finds every file in place and makes no new link', async () => {
    write(path.join(source, 'Part 1.mp3'), 'one');
    await organize({ filePlacement: 'hardlink' });
    fsState.linkCalls = [];

    const again = await organize({ filePlacement: 'hardlink' });

    expect(again.success).toBe(true);
    expect(again.records![0]).toMatchObject({ status: 'identical', verified: true });
    expect(again.linkedCount).toBe(0);
    expect(again.filesMovedCount).toBe(0);
    expect(fsState.linkCalls.filter((c) => c.source.endsWith('.mp3'))).toEqual([]);
  });

  describe('a source outside the download folders (Manual Import, Bulk Import from the media folder)', () => {
    let shelf: string;
    beforeEach(() => {
      shelf = path.join(media, 'Old Shelf', 'Book');
      write(path.join(shelf, 'Part 1.mp3'), 'one');
      write(path.join(shelf, 'Part 2.mp3'), 'two');
    });

    it('Hard link (copy if not possible) copies the whole book, as Copy mode does, and says why', async () => {
      const result = await organize({ filePlacement: 'hardlink', writeOpf: true }, shelf);

      expect(result.success).toBe(true);
      expect(result.linkFallback).toEqual({ code: 'OUTSIDE', words: 'the files are not in a download folder' });
      expect(result.records!.map((r) => [path.basename(r.target), r.status, !!r.linked])).toEqual([['Part 1.mp3', 'copied', false], ['Part 2.mp3', 'copied', false]]);
      expect(ino(path.join(book, 'Part 1.mp3'))).not.toBe(ino(path.join(shelf, 'Part 1.mp3')));
      expect(fsState.linkCalls.filter((c) => c.source.endsWith('.mp3'))).toEqual([]);
      expect(fs.existsSync(path.join(book, 'metadata.opf'))).toBe(true);
    });

    it('Hard link only imports nothing and gives that reason', async () => {
      const result = await organize({ filePlacement: 'hardlink_only', writeOpf: true }, shelf);

      expect(result.success).toBe(false);
      expect(result.linkRefused).toEqual({ code: 'OUTSIDE', words: 'the files are not in a download folder' });
      expect(fs.existsSync(book)).toBe(false);
      expect(fs.readdirSync(shelf).sort()).toEqual(['Part 1.mp3', 'Part 2.mp3']);
    });

    it.each(['hardlink', 'hardlink_only'] as const)('a Bulk Import of a book already in its place imports in place under %s, with no copy note', async (filePlacement) => {
      write(path.join(book, 'Part 1.mp3'), 'one');
      write(path.join(book, 'Part 2.mp3'), 'two');
      const result = await organize({ filePlacement, writeOpf: true }, book);

      expect(result.success).toBe(true);
      expect(result.records!.map((r) => r.status)).toEqual(['identical', 'identical']);
      expect(result.linkFallback).toBeUndefined();
      expect(result.linkRefused).toBeUndefined();
      expect(result.filesMovedCount).toBe(0);
      expect(fs.readFileSync(path.join(book, 'Part 1.mp3'), 'utf8')).toBe('one');
      expect(fs.existsSync(path.join(book, 'metadata.opf'))).toBe(true);
    });

    it('a book in the media folder under other names is a real copy and keeps the note', async () => {
      const result = await organize({ filePlacement: 'hardlink' }, shelf);

      expect(result.linkFallback).toMatchObject({ code: 'OUTSIDE' });
      expect(result.filesMovedCount).toBe(2);
    });
  });

  describe('one file that cannot be linked safely decides the whole book', () => {
    it('Hard link (copy if not possible): a third file that is a symbolic link makes the book Copy mode, call for call', async () => {
      configState.values.set('chapter_merging_enabled', 'false');
      const files = ['Part 1.mp3', 'Part 2.mp3', 'Part 3.mp3'].map((name, i) => write(path.join(source, name), `part ${i}`));
      fsState.fakeSymlinks.add(path.resolve(files[2]));

      await organize({ writeOpf: true, metadataTaggingEnabled: false });
      const copyCalls = placeState.audioCalls;
      fs.rmSync(path.join(media, 'Ann Writer, Ben Co-Writer'), { recursive: true });
      placeState.audioCalls = [];

      const result = await organize({ filePlacement: 'hardlink', writeOpf: true });

      expect(result.linkFallback).toMatchObject({ code: 'SYMLINK' });
      expect(fsState.linkCalls.filter((c) => c.source.endsWith('.mp3'))).toEqual([]);
      expect(copyCalls).toHaveLength(3);
      expect(placeState.audioCalls).toEqual(copyCalls);
    });

    it('Hard link only: a symbolic link among the files imports nothing', async () => {
      write(path.join(source, 'Part 1.mp3'), 'one');
      const link = write(path.join(source, 'Part 2.mp3'), 'two');
      fsState.fakeSymlinks.add(path.resolve(link));

      const result = await organize({ filePlacement: 'hardlink_only', writeOpf: true });

      expect(result.linkRefused).toMatchObject({ code: 'SYMLINK', words: 'a download file is a symbolic link' });
      expect(fs.existsSync(book)).toBe(false);
    });
  });

  describe('a failure in the middle of the link pass leaves no link and no OPF of this run', () => {
    const five = () => [1, 2, 3, 4, 5].map((n) => write(path.join(source, `Part ${n}.mp3`), `part ${n}`));

    it('Hard link (copy if not possible): an error on file 3 of 5 removes links 1 and 2, then copies the book', async () => {
      const sources = five();
      fsState.failLinkNamed = { name: 'Part 3.mp3', code: 'EACCES' };

      const result = await organize({ filePlacement: 'hardlink', writeOpf: true });

      expect(result.success).toBe(true);
      expect(result.linkFallback).toMatchObject({ code: 'EACCES' });
      expect(result.linkedCount ?? 0).toBe(0);
      for (const s of sources) expect(fs.statSync(s).nlink).toBe(1);
      expect(result.records!.every((r) => r.status === 'copied' && !r.linked)).toBe(true);
      expect(fs.readdirSync(book).sort()).toEqual(['Part 1.mp3', 'Part 2.mp3', 'Part 3.mp3', 'Part 4.mp3', 'Part 5.mp3', 'metadata.opf']);
    });

    it('Hard link only: an error on file 3 of 5 removes links 1 and 2 and the OPF', async () => {
      const sources = five();
      fsState.failLinkNamed = { name: 'Part 3.mp3', code: 'EIO' };

      const result = await organize({ filePlacement: 'hardlink_only', writeOpf: true });

      expect(result.linkRefused).toMatchObject({ code: 'EIO' });
      expect(result.linkLeftBehind ?? []).toEqual([]);
      for (const s of sources) expect(fs.statSync(s).nlink).toBe(1);
      expect(fs.existsSync(book)).toBe(false);
    });
  });

  it('a metadata.opf that cannot be written is reported for the request, and the book is still imported', async () => {
    write(path.join(source, 'Part 1.mp3'), 'one');
    opfState.failWrite = 'EACCES';

    const result = await organize({ filePlacement: 'hardlink', writeOpf: true });

    expect(result.success).toBe(true);
    expect(result.opfError).toBe('EACCES');
    expect(result.linkedCount).toBe(1);
  });

  it('an OPF that failed before the link pass and is written by the copy fallback leaves no error behind', async () => {
    write(path.join(source, 'Part 1.mp3'), 'one');
    fsState.failLinkNamed = { name: 'Part 1.mp3', code: 'EXDEV' };
    opfState.failWrite = 'EACCES';
    opfState.once = true;

    const result = await organize({ filePlacement: 'hardlink', writeOpf: true });

    expect(result.linkFallback).toMatchObject({ code: 'EXDEV' });
    expect(fs.existsSync(path.join(book, 'metadata.opf'))).toBe(true);
    expect(result.opfError).toBeUndefined();
    expect(result.errors).not.toContain('Failed to write metadata.opf');
  });

  it('copy (the default) is unchanged: tags and merge still run', async () => {
    write(path.join(source, 'Part 1.mp3'), 'one');
    write(path.join(source, 'Part 2.mp3'), 'two');

    await organize({ metadataTaggingEnabled: true });

    expect(detectChapterFiles).toHaveBeenCalled();
    expect(tagMultipleFiles).toHaveBeenCalled();
    expect(fsState.chmodCalls.map((p) => path.basename(p)).sort()).toEqual(['Part 1.mp3', 'Part 2.mp3']);
    expect(fs.existsSync(path.join(book, 'metadata.opf'))).toBe(false);
  });
});
