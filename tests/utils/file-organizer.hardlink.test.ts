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
}));
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
    return actual.link(source as string, target as string);
  }) as typeof actual.link;
  return { ...actual, default: { ...actual, chmod, link }, chmod, link };
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
import { OUTSIDE_SOURCE } from '@/lib/utils/book-link';

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

  it('a source outside the download folders is neither linked nor copied, even when the rest falls back', async () => {
    write(path.join(source, 'Part 1.mp3'), 'one');
    const elsewhere = path.join(root, 'elsewhere', 'Book');
    write(path.join(elsewhere, 'Part 1.mp3'), 'one');

    const result = await organize({ filePlacement: 'hardlink' }, elsewhere);

    expect(result.success).toBe(false);
    expect(result.records).toEqual([expect.objectContaining({ status: 'failed', verified: false, reason: OUTSIDE_SOURCE })]);
    expect(fs.existsSync(path.join(book, 'Part 1.mp3'))).toBe(false);
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
