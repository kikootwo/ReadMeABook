/**
 * Component: File Organization Placement Records Tests (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 *
 * The real organizer on real temp folders, with tagging and probing replaced
 * so derivative and partial-failure paths can be driven deterministically.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configState = vi.hoisted(() => ({ values: new Map<string, string>() }));
const taggingState = vi.hoisted(() => ({
  enabled: false,
  /** Files whose source disappears while tagging runs (simulates a vanished or unreadable file). */
  vanish: new Set<string>(),
}));
const probeState = vi.hoisted(() => ({ libraryDuration: 60000, sourceDuration: 60000, taggedDuration: 60000, libraryRoot: '' }));
const lockedDirs = vi.hoisted(() => new Set<string>());
const mergeState = vi.hoisted(() => ({ durationVerified: true }));
/** Error code chmod fails with (mergerfs/NFS/FUSE refuse chmod after a successful write). */
const chmodState = vi.hoisted(() => ({ error: null as string | null }));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const readdir = (async (dir: unknown, ...rest: unknown[]) => {
    if (lockedDirs.has(String(dir))) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    return (actual.readdir as (...a: unknown[]) => unknown)(dir, ...rest);
  }) as typeof actual.readdir;
  const chmod = (async (p: unknown, mode: unknown) => {
    if (chmodState.error) throw Object.assign(new Error(`${chmodState.error}: operation not permitted, chmod '${p}'`), { code: chmodState.error });
    return (actual.chmod as (...a: unknown[]) => unknown)(p, mode);
  }) as typeof actual.chmod;
  return { ...actual, default: { ...actual, readdir, chmod }, readdir, chmod };
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

vi.mock('@/lib/utils/metadata-tagger', () => ({
  checkFfmpegAvailable: vi.fn(async () => true),
  addMp4FreeformTags: vi.fn(async () => ({ written: false })),
  tagMultipleFiles: vi.fn(async (files: string[]) => {
    const nodeFs = await import('fs');
    return files.map((filePath) => {
      if (taggingState.vanish.has(path.basename(filePath))) {
        nodeFs.rmSync(filePath, { force: true });
        return { success: false, filePath, error: 'gone' };
      }
      const taggedFilePath = `${filePath}.tmp`;
      nodeFs.writeFileSync(taggedFilePath, Buffer.concat([Buffer.from('TAGS'), nodeFs.readFileSync(filePath)]));
      return { success: true, filePath, taggedFilePath };
    });
  }),
}));

vi.mock('@/lib/utils/audio-duration', () => ({
  probeStreamDurationMs: vi.fn(async (filePath: string) =>
    filePath.endsWith('.tmp') ? probeState.taggedDuration : probeState.sourceDuration
  ),
}));

vi.mock('@/lib/utils/chapter-merger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/chapter-merger')>();
  return {
    ...actual,
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
      return {
        success: true,
        outputPath: options.outputPath,
        totalDuration: 60000,
        actualDuration: 60000,
        durationVerified: mergeState.durationVerified,
      };
    }),
    probeAudioFile: vi.fn(async (filePath: string) => ({
      duration: probeState.libraryRoot && filePath.startsWith(probeState.libraryRoot)
        ? probeState.libraryDuration
        : probeState.sourceDuration,
      format: 'm4b',
    })),
  };
});

import { probeStreamDurationMs } from '@/lib/utils/audio-duration';
import { FileOrganizer } from '@/lib/utils/file-organizer';
import { coerceToPlexCompatible, coercibleTargets } from '@/lib/utils/format-coercion';

let root: string;
let media: string;
let source: string;

function write(file: string, data: string | Buffer): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}

async function organize(selected?: string[]) {
  const organizer = new FileOrganizer(media, path.join(root, 'tmp'));
  return organizer.organize(source, { title: 'Book', author: 'Author' }, '{author}/{title}', undefined, undefined, selected, {
    compareExisting: true,
  });
}

describe('FileOrganizer placement records', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-records-')));
    media = path.join(root, 'media');
    source = path.join(root, 'downloads', 'Book.Name');
    configState.values.clear();
    taggingState.enabled = false;
    taggingState.vanish.clear();
    probeState.libraryRoot = media;
    probeState.libraryDuration = 60000;
    probeState.sourceDuration = 60000;
    probeState.taggedDuration = 60000;
    lockedDirs.clear();
    mergeState.durationVerified = true;
    chmodState.error = null;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('records every source as verified after a clean copy, with a complete inventory', async () => {
    const a = write(path.join(source, 'Part 1.mp3'), 'one');
    const b = write(path.join(source, 'Part 2.mp3'), 'two');

    const result = await organize();

    expect(result.success).toBe(true);
    expect(result.inventory).toMatchObject({ kind: 'audio', complete: true });
    expect(result.inventory!.files.sort()).toEqual([a, b].sort());
    expect(result.records!.map((r) => [r.source, r.status, r.verified]).sort()).toEqual(
      [[a, 'copied', true], [b, 'copied', true]].sort()
    );
  });

  it('records a partial success: the vanished file is failed, the rest verified', async () => {
    configState.values.set('metadata_tagging_enabled', 'true');
    write(path.join(source, 'Part 1.mp3'), 'one');
    const gone = write(path.join(source, 'Part 2.mp3'), 'two');
    taggingState.vanish.add('Part 2.mp3');

    const result = await organize();

    expect(result.success).toBe(true);
    const byName = new Map(result.records!.map((r) => [path.basename(r.source), r]));
    expect(byName.get('Part 1.mp3')).toMatchObject({ status: 'copied', verified: true });
    expect(byName.get('Part 2.mp3')).toMatchObject({ status: 'failed', verified: false });
    expect(result.inventory!.files).toContain(gone);
  });

  it('places the original untagged when the tagged copy loses duration', async () => {
    configState.values.set('metadata_tagging_enabled', 'true');
    write(path.join(source, 'Book.m4b'), 'original-bytes');
    // The tagged copy probes 40 s short of the original (checked before it is placed)
    probeState.taggedDuration = 20000;

    const result = await organize();

    const placed = path.join(media, 'Author', 'Book', 'Book.m4b');
    expect(fs.readFileSync(placed, 'utf8')).toBe('original-bytes');
    expect(result.records![0]).toMatchObject({
      status: 'copied', verified: true, tagsDropped: 'the tagged version had a different length',
    });
    expect(fs.existsSync(path.join(source, 'Book.m4b.tmp'))).toBe(false);
  });

  it.each(['EPERM', 'ENOTSUP'])('a %s chmod after the tagged copy keeps the tagged file and the import succeeds', async (code) => {
    configState.values.set('metadata_tagging_enabled', 'true');
    write(path.join(source, 'Book.m4b'), 'original-bytes');
    write(path.join(source, 'cover.jpg'), 'cover-bytes');
    chmodState.error = code;

    const result = await organize();

    const placed = path.join(media, 'Author', 'Book', 'Book.m4b');
    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(fs.readFileSync(placed, 'utf8')).toBe('TAGSoriginal-bytes');
    expect(result.records![0]).toMatchObject({ status: 'copied', verified: true });
    expect(result.coverRecord).toMatchObject({ status: 'copied', verified: true });
    // Collected for one summary per job, not logged per file
    expect(result.permissionWarnings).toHaveLength(2);
    expect(result.permissionWarnings!.every((w) => w.includes(code))).toBe(true);
  });

  it('never places a short tagged copy for a torrent import (no delete now, seeding cleanup removes the download later)', async () => {
    configState.values.set('metadata_tagging_enabled', 'true');
    write(path.join(source, 'Book.mp3'), 'original-bytes');
    probeState.sourceDuration = 10000;
    probeState.taggedDuration = 4049;

    const organizer = new FileOrganizer(media, path.join(root, 'tmp'));
    const result = await organizer.organize(source, { title: 'Book', author: 'Author' }, '{author}/{title}', undefined, undefined, undefined, {
      compareExisting: false,
    });

    expect(fs.readFileSync(path.join(media, 'Author', 'Book', 'Book.mp3'), 'utf8')).toBe('original-bytes');
    expect(result.records![0]).toMatchObject({ status: 'copied', verified: true });
    expect(result.records![0].tagsDropped).toBeDefined();
  });
  it('renames the .mp4 an earlier attempt placed, on the retry after a crash before coercion (torrent import)', async () => {
    write(path.join(source, 'Book.mp4'), 'audio-bytes');
    const organizer = new FileOrganizer(media, path.join(root, 'tmp'));
    const run = () => organizer.organize(source, { title: 'Book', author: 'Author' }, '{author}/{title}', undefined, undefined, undefined, {
      compareExisting: false,
    });
    const first = await run();
    expect(first.records![0]).toMatchObject({ status: 'copied' });
    // Crash here: coercion never ran, the library holds Book.mp4

    const retry = await run();
    const coercion = await coerceToPlexCompatible(retry.audioFiles, coercibleTargets(retry.records!));

    const lib = path.join(media, 'Author', 'Book');
    expect(retry.records![0]).toMatchObject({ status: 'identical' });
    expect(coercion.renamed).toHaveLength(1);
    expect(fs.readdirSync(lib)).toEqual(['Book.m4b']);
  });

  it('never renames a same-size library .mp4 with different content on a torrent import', async () => {
    write(path.join(source, 'Book.mp4'), 'audio-bytes');
    const lib = path.join(media, 'Author', 'Book');
    write(path.join(lib, 'Book.mp4'), 'other-bytes');
    const organizer = new FileOrganizer(media, path.join(root, 'tmp'));

    const result = await organizer.organize(source, { title: 'Book', author: 'Author' }, '{author}/{title}', undefined, undefined, undefined, {
      compareExisting: false,
    });
    await coerceToPlexCompatible(result.audioFiles, coercibleTargets(result.records!));

    expect(result.records![0]).toMatchObject({ status: 'differs' });
    expect(fs.readdirSync(lib)).toEqual(['Book.mp4']);
    expect(fs.readFileSync(path.join(lib, 'Book.mp4'), 'utf8')).toBe('other-bytes');
  });

  it('re-copies a truncated library file and keeps a different one untouched', async () => {
    write(path.join(source, 'Part 1.mp3'), 'complete first part');
    write(path.join(source, 'Part 2.mp3'), 'complete second part');
    const target = path.join(media, 'Author', 'Book');
    write(path.join(target, 'Part 1.mp3'), 'complete fi');
    write(path.join(target, 'Part 2.mp3'), 'a different book');

    const result = await organize();

    expect(fs.readFileSync(path.join(target, 'Part 1.mp3'), 'utf8')).toBe('complete first part');
    expect(fs.readFileSync(path.join(target, 'Part 2.mp3'), 'utf8')).toBe('a different book');
    const byName = new Map(result.records!.map((r) => [path.basename(r.source), r]));
    expect(byName.get('Part 1.mp3')).toMatchObject({ status: 'copied', verified: true });
    expect(byName.get('Part 2.mp3')).toMatchObject({ status: 'differs', verified: false });
    expect(result.errors.join(' ')).toContain('Part 2.mp3 not imported');
  });

  it('records a library symlink to the download as differs, unverified (tagged, no byte compare)', async (ctx) => {
    configState.values.set('metadata_tagging_enabled', 'true');
    const original = write(path.join(source, 'Book.m4b'), 'original-bytes');
    const placed = path.join(media, 'Author', 'Book', 'Book.m4b');
    fs.mkdirSync(path.dirname(placed), { recursive: true });
    try {
      fs.symlinkSync(original, placed, 'file');
    } catch (error) {
      // File symlinks need a privilege on Windows; organize-copy.symlink.test.ts simulates this case
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return ctx.skip();
      throw error;
    }

    const organizer = new FileOrganizer(media, path.join(root, 'tmp'));
    const result = await organizer.organize(source, { title: 'Book', author: 'Author' }, '{author}/{title}', undefined, undefined, undefined, {
      compareExisting: false,
    });

    expect(result.records![0]).toMatchObject({ source: original, status: 'differs', verified: false });
    expect(fs.lstatSync(placed).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(original, 'utf8')).toBe('original-bytes');
  });

  it('succeeds when every file is already in the library with different content (nothing overwritten)', async () => {
    write(path.join(source, 'Part 1.mp3'), 'new download one');
    const target = path.join(media, 'Author', 'Book');
    write(path.join(target, 'Part 1.mp3'), 'the library copy, longer than the new one');

    const result = await organize();

    expect(result.success).toBe(true);
    expect(result.records![0]).toMatchObject({ status: 'differs', verified: false });
    expect(fs.readFileSync(path.join(target, 'Part 1.mp3'), 'utf8')).toBe('the library copy, longer than the new one');
  });

  it('marks the inventory incomplete when a source folder cannot be listed', async () => {
    write(path.join(source, 'Part 1.mp3'), 'one');
    const nested = path.join(source, 'Disc 2');
    write(path.join(nested, 'Part 2.mp3'), 'two');
    lockedDirs.add(nested);

    const result = await organize();

    expect(result.inventory!.complete).toBe(false);
  });

  it.each([
    [true, true],
    [false, false],
  ])('records merged chapters as verified only when the merge duration is verified (%s)', async (durationVerified, expected) => {
    configState.values.set('chapter_merging_enabled', 'true');
    mergeState.durationVerified = durationVerified;
    const a = write(path.join(source, '01.mp3'), 'one');
    const b = write(path.join(source, '02.mp3'), 'two');

    const result = await organize();

    expect(fs.readFileSync(path.join(media, 'Author', 'Book', 'Book.m4b'), 'utf8')).toBe('merged-m4b');
    expect(result.records!.map((r) => r.source).sort()).toEqual([a, b].sort());
    expect(result.records!.every((r) => r.status === 'copied' && r.verified === expected)).toBe(true);
  });
});
