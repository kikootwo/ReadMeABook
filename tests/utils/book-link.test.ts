/**
 * Component: Hard Link Publish and Book Link Pass Tests (real filesystem)
 * Documentation: documentation/features/library-placement.md
 *
 * Real link() on temp folders (NTFS on Windows, ext4/overlay on Linux); errors the
 * local filesystem can't produce (EXDEV, EPERM, ...) are injected through link().
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RealLink = () => Promise<void>;
const fsState = vi.hoisted(() => ({
  linkHook: null as null | ((source: string, target: string, real: RealLink) => Promise<void>),
  devOverride: null as null | { path: string; dev: bigint },
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const nodePath = await import('path');
  const link = (async (source: unknown, target: unknown) => {
    const real = () => actual.link(source as string, target as string);
    return fsState.linkHook ? fsState.linkHook(String(source), String(target), real) : real();
  }) as typeof actual.link;
  const stat = (async (p: unknown, options?: unknown) => {
    const result = await (actual.stat as (...a: unknown[]) => Promise<object>)(p, options);
    const override = fsState.devOverride;
    if (override && nodePath.resolve(String(p)) === override.path) {
      return Object.assign(Object.create(Object.getPrototypeOf(result)), result, { dev: override.dev });
    }
    return result;
  }) as typeof actual.stat;
  return { ...actual, default: { ...actual, link, stat }, link, stat };
});

const rootsState = vi.hoisted(() => ({ roots: null as null | { mediaDir: string; downloadRoots: string[]; otherRoots: string[] }, fail: false }));
vi.mock('@/lib/processors/organize-cleanup-guard', () => ({
  collectGuardRoots: vi.fn(async () => {
    if (rootsState.fail) throw new Error('Could not read the configured roots');
    return { ...rootsState.roots!, sweepRoots: [], mappedRoots: [] };
  }),
}));

import { linkInto } from '@/lib/utils/link-file';
import { linkBook, OUTSIDE_SOURCE, SYMLINK_SOURCE } from '@/lib/utils/book-link';

const errno = (code: string) => Object.assign(new Error(`${code}: injected`), { code });
const identity = (p: string) => {
  const s = fs.lstatSync(p, { bigint: true });
  return { dev: s.dev, ino: s.ino };
};
const nlink = (p: string) => fs.statSync(p).nlink;

let base: string;
let downloads: string;
let media: string;
let book: string;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-link-')));
  downloads = path.join(base, 'downloads');
  media = path.join(base, 'media');
  book = path.join(media, 'Author', 'Title');
  fs.mkdirSync(path.join(downloads, 'Torrent'), { recursive: true });
  fs.mkdirSync(book, { recursive: true });
  rootsState.roots = { mediaDir: media, downloadRoots: [downloads], otherRoots: [path.join(base, 'bookdrop')] };
  rootsState.fail = false;
  fsState.linkHook = null;
  fsState.devOverride = null;
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function download(name: string, content = `audio ${name}`): string {
  const file = path.join(downloads, 'Torrent', name);
  fs.writeFileSync(file, content);
  return file;
}

function bookFiles(...names: string[]) {
  return names.map((name) => ({ source: download(name), target: path.join(book, name) }));
}

const run = (files: Array<{ source: string; target: string }>) =>
  linkBook({ files, targetDir: book, fileMode: 0o600, compareExisting: () => false });

describe('linkInto', () => {
  it('links the file: same dev and inode, 2 links, no bytes written', async () => {
    const source = download('a.m4b');
    const target = path.join(book, 'a.m4b');
    expect(await linkInto(source, target, identity(source))).toEqual({ kind: 'linked' });
    expect(identity(target)).toEqual(identity(source));
    expect(nlink(source)).toBe(2);
  });

  it('reports an existing target name without touching it', async () => {
    const source = download('a.m4b');
    const target = path.join(book, 'a.m4b');
    fs.writeFileSync(target, 'library');
    expect(await linkInto(source, target, identity(source))).toEqual({ kind: 'exists' });
    expect(fs.readFileSync(target, 'utf8')).toBe('library');
  });

  it.each(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EMLINK', 'EINVAL'])('%s means the book cannot be linked', async (code) => {
    fsState.linkHook = async () => { throw errno(code); };
    const source = download('a.m4b');
    const outcome = await linkInto(source, path.join(book, 'a.m4b'), identity(source));
    expect(outcome).toMatchObject({ kind: 'refused', refusal: { code } });
  });

  it.each(['EACCES', 'ENOENT', 'EIO'])('%s is a per-file failure, as a failed copy would be', async (code) => {
    fsState.linkHook = async () => { throw errno(code); };
    const source = download('a.m4b');
    expect((await linkInto(source, path.join(book, 'a.m4b'), identity(source))).kind).toBe('failed');
  });

  it('a link that reports another inode (CIFS noserverino, mergerfs copy) is removed by name and refused', async () => {
    fsState.linkHook = async (source, target) => { fs.copyFileSync(source, target); };
    const source = download('a.m4b');
    const target = path.join(book, 'a.m4b');
    expect(await linkInto(source, target, identity(source))).toMatchObject({ kind: 'refused', refusal: { code: 'VERIFY' } });
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readFileSync(source, 'utf8')).toBe('audio a.m4b');
  });

  it('a source swapped after the precheck fails the identity check and the name is removed', async () => {
    const source = download('a.m4b');
    const captured = identity(source);
    fs.rmSync(source);
    fs.writeFileSync(source, 'another file');
    const target = path.join(book, 'a.m4b');
    expect(await linkInto(source, target, captured)).toMatchObject({ kind: 'refused', refusal: { code: 'VERIFY' } });
    expect(fs.existsSync(target)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('mergerfs-style symlink on EXDEV is caught and removed', async () => {
    fsState.linkHook = async (source, target) => { fs.symlinkSync(source, target); };
    const source = download('a.m4b');
    const target = path.join(book, 'a.m4b');
    expect(await linkInto(source, target, identity(source))).toMatchObject({ kind: 'refused', refusal: { code: 'VERIFY' } });
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(source)).toBe(true);
  });
});

describe('linkBook', () => {
  it('links every file of the book', async () => {
    const files = bookFiles('01.mp3', '02.mp3');
    const outcome = await run(files);
    expect(outcome.kind).toBe('placed');
    if (outcome.kind !== 'placed') return;
    expect(outcome.placed.map((p) => [p.result.status, p.result.linked])).toEqual([['copied', true], ['copied', true]]);
    for (const f of files) expect(identity(f.target)).toEqual(identity(f.source));
  });

  it('never changes the permissions of a linked file (it is the download)', async () => {
    const [file] = bookFiles('01.mp3');
    fs.chmodSync(file.source, 0o644);
    const before = fs.statSync(file.source).mode;
    await linkBook({ files: [file], targetDir: book, fileMode: 0o600, compareExisting: () => false });
    expect(fs.statSync(file.source).mode).toBe(before);
  });

  it('a third file failing with EXDEV removes the first two links; the downloads are intact', async () => {
    const files = bookFiles('01.mp3', '02.mp3', '03.mp3');
    fsState.linkHook = async (source, _target, real) => {
      if (source.endsWith('03.mp3')) throw errno('EXDEV');
      return real();
    };
    const outcome = await run(files);
    expect(outcome).toMatchObject({ kind: 'cannot', refusal: { code: 'EXDEV' } });
    for (const f of files) {
      expect(fs.existsSync(f.target)).toBe(false);
      expect(nlink(f.source)).toBe(1);
      expect(fs.readFileSync(f.source, 'utf8')).toBe(`audio ${path.basename(f.source)}`);
    }
  });

  it('leaves a name replaced during the pass and an earlier run\'s link alone on rollback', async () => {
    const files = bookFiles('01.mp3', '02.mp3', '03.mp3');
    fs.linkSync(files[1].source, files[1].target); // earlier run: identical, not this run's link
    fsState.linkHook = async (source, _target, real) => {
      if (source.endsWith('03.mp3')) {
        fs.rmSync(files[0].target);
        fs.writeFileSync(files[0].target, 'someone else');
        throw errno('EXDEV');
      }
      return real();
    };
    const outcome = await run(files);
    expect(outcome.kind).toBe('cannot');
    expect(fs.readFileSync(files[0].target, 'utf8')).toBe('someone else');
    expect(identity(files[1].target)).toEqual(identity(files[1].source));
  });

  it('refuses the book when the source and the book folder are on different devices', async () => {
    const files = bookFiles('01.mp3');
    fsState.devOverride = { path: path.resolve(book), dev: BigInt(424242) };
    fsState.linkHook = async () => { throw new Error('link must not be attempted'); };
    expect(await run(files)).toMatchObject({ kind: 'cannot', refusal: { code: 'EXDEV' } });
  });

  it('refuses the book when the configured folders cannot be read', async () => {
    rootsState.fail = true;
    expect(await run(bookFiles('01.mp3'))).toMatchObject({ kind: 'cannot', refusal: { code: 'ROOTS' } });
  });

  it('refuses the book when its folder is outside the media folder (a template with ..)', async () => {
    const outside = path.join(base, 'elsewhere');
    fs.mkdirSync(outside);
    const files = [{ source: download('01.mp3'), target: path.join(outside, '01.mp3') }];
    expect(await linkBook({ files, targetDir: outside, fileMode: 0o600, compareExisting: () => false }))
      .toMatchObject({ kind: 'cannot', refusal: { code: 'TARGET' } });
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('refuses the book when the download is inside the media folder', async () => {
    const nested = path.join(media, 'downloads');
    fs.mkdirSync(nested);
    rootsState.roots!.downloadRoots = [nested];
    const source = path.join(nested, '01.mp3');
    fs.writeFileSync(source, 'x');
    expect(await run([{ source, target: path.join(book, '01.mp3') }])).toMatchObject({ kind: 'cannot', refusal: { code: 'IN_LIBRARY' } });
  });

  it('refuses a source outside the download folders per file, never linking it', async () => {
    const stray = path.join(base, 'stray.mp3');
    fs.writeFileSync(stray, 'stray');
    const [good] = bookFiles('01.mp3');
    const outcome = await run([good, { source: stray, target: path.join(book, 'stray.mp3') }]);
    expect(outcome.kind).toBe('placed');
    expect(outcome.refused).toEqual([{ file: { source: stray, target: path.join(book, 'stray.mp3') }, reason: OUTSIDE_SOURCE }]);
    expect(fs.existsSync(path.join(book, 'stray.mp3'))).toBe(false);
  });

  it('refuses a source whose folder is a link leading out of the download folders', async () => {
    const outside = path.join(base, 'secret');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'x.mp3'), 'secret');
    fs.symlinkSync(outside, path.join(downloads, 'Torrent', 'escape'), 'junction');
    const source = path.join(downloads, 'Torrent', 'escape', 'x.mp3');
    const outcome = await run([{ source, target: path.join(book, 'x.mp3') }]);
    expect(outcome.refused.map((r) => r.reason)).toEqual([OUTSIDE_SOURCE]);
    expect(fs.existsSync(path.join(book, 'x.mp3'))).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('refuses a symlinked download file per file', async () => {
    const real = download('real.mp3');
    const source = path.join(downloads, 'Torrent', 'link.mp3');
    fs.symlinkSync(real, source);
    const outcome = await run([{ source, target: path.join(book, 'link.mp3') }]);
    expect(outcome.refused.map((r) => r.reason)).toEqual([SYMLINK_SOURCE]);
    expect(fs.existsSync(path.join(book, 'link.mp3'))).toBe(false);
  });

  it('an interrupted copy in the way is a book-level refusal (the copy repairs it)', async () => {
    const [file] = bookFiles('01.mp3');
    fs.writeFileSync(file.target, 'audio'); // a byte-prefix of "audio 01.mp3"
    expect(await run([file])).toMatchObject({ kind: 'cannot', refusal: { code: 'PREFIX' } });
    expect(fs.readFileSync(file.target, 'utf8')).toBe('audio');
  });

  it('applies the copy\'s existing-target rules: another file by the name is left untouched', async () => {
    const [file] = bookFiles('01.mp3');
    fs.writeFileSync(file.target, 'a different, longer library file');
    const outcome = await run([file]);
    expect(outcome.kind === 'placed' && outcome.placed[0].result.status).toBe('differs');
    expect(fs.readFileSync(file.target, 'utf8')).toBe('a different, longer library file');
  });

  it('two passes for one book run one after the other, so a rolled-back link is never reported as in place', async () => {
    const files = bookFiles('01.mp3', '02.mp3');
    let failFirstPass = true;
    fsState.linkHook = async (source, _target, real) => {
      if (failFirstPass && source.endsWith('02.mp3')) {
        failFirstPass = false;
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw errno('EXDEV');
      }
      return real();
    };
    const [first, second] = await Promise.all([run(files), run(files)]);
    expect(first.kind).toBe('cannot');
    expect(second.kind).toBe('placed');
    if (second.kind !== 'placed') return;
    for (const { result } of second.placed) {
      expect(result.linked).toBe(true);
      expect(fs.existsSync(result.target)).toBe(true);
    }
  });
});
