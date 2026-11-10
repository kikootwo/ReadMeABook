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
  // Paths lstat reports as a symbolic link (file symlinks need admin rights on Windows)
  fakeSymlinks: new Set<string>(),
  // Every handle fs.open returned (the link pass pins its sources)
  opened: [] as Array<{ fd: number }>,
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
  const lstat = (async (p: unknown, options?: unknown) => {
    const result = await (actual.lstat as (...a: unknown[]) => Promise<object>)(p, options);
    if (!fsState.fakeSymlinks.has(nodePath.resolve(String(p)))) return result;
    return Object.assign(Object.create(Object.getPrototypeOf(result)), result, { isSymbolicLink: () => true, isFile: () => false });
  }) as typeof actual.lstat;
  const open = (async (...args: unknown[]) => {
    const handle = await (actual.open as (...a: unknown[]) => Promise<{ fd: number }>)(...args);
    fsState.opened.push(handle);
    return handle;
  }) as typeof actual.open;
  return { ...actual, default: { ...actual, link, stat, lstat, open }, link, stat, lstat, open };
});

const placeState = vi.hoisted(() => ({ hook: null as null | ((source: string, real: () => Promise<unknown>) => Promise<unknown>) }));
vi.mock('@/lib/utils/organize-copy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/organize-copy')>();
  const placeFile = (async (source: string, target: string, options: Parameters<typeof actual.placeFile>[2]) => {
    const real = () => actual.placeFile(source, target, options);
    return placeState.hook ? placeState.hook(source, real) : real();
  }) as typeof actual.placeFile;
  return { ...actual, placeFile };
});

const rootsState = vi.hoisted(() => ({ roots: null as null | { mediaDir: string; downloadRoots: string[]; otherRoots: string[] }, fail: false }));
vi.mock('@/lib/processors/organize-cleanup-guard', () => ({
  collectGuardRoots: vi.fn(async () => {
    if (rootsState.fail) throw new Error('Could not read the configured roots');
    return { ...rootsState.roots!, sweepRoots: [], mappedRoots: [] };
  }),
}));

import { linkInto, pinFile } from '@/lib/utils/link-file';
import { linkBook } from '@/lib/utils/book-link';

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
  fsState.fakeSymlinks.clear();
  fsState.opened = [];
  placeState.hook = null;
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

  it.each(['EACCES', 'ENOENT', 'EIO'])('%s is refused too: the book then copies or stops as a whole', async (code) => {
    fsState.linkHook = async () => { throw errno(code); };
    const source = download('a.m4b');
    expect(await linkInto(source, path.join(book, 'a.m4b'), identity(source))).toMatchObject({ kind: 'refused', refusal: { code } });
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
    // The precheck pins the source (book-link.ts), as here
    const pin = await pinFile(source);
    if (!('pinned' in pin)) throw new Error('not pinned');
    try {
      fs.rmSync(source);
      fs.writeFileSync(source, 'another file');
      const target = path.join(book, 'a.m4b');
      expect(await linkInto(source, target, pin.pinned.id)).toMatchObject({ kind: 'refused', refusal: { code: 'VERIFY' } });
      expect(fs.existsSync(target)).toBe(false);
    } finally {
      await pin.pinned.close();
    }
  });

  it('a pinned file keeps its inode number from a replacement (Linux reuses a freed one at once)', async () => {
    const source = download('a.m4b');
    const pin = await pinFile(source);
    if (!('pinned' in pin)) throw new Error('not pinned');
    try {
      fs.rmSync(source);
      fs.writeFileSync(source, 'audio a.m4b');
      expect(identity(source).ino).not.toBe(pin.pinned.id.ino);
    } finally {
      await pin.pinned.close();
    }
  });

  it('pinFile refuses a folder, and a symbolic link without following it', async () => {
    expect(await pinFile(downloads)).toEqual({ code: 'NOT_REGULAR' });
    if (process.platform !== 'win32') {
      const link = path.join(downloads, 'link.m4b');
      fs.symlinkSync(download('real.m4b'), link);
      expect(await pinFile(link)).toEqual({ code: 'SYMLINK' });
    }
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
  it('holds every source open during the pass and closes them all after it, linked or not', async () => {
    expect((await run(bookFiles('01.mp3', '02.mp3'))).kind).toBe('placed');
    fsState.linkHook = async (source, _target, real) => {
      if (source.endsWith('13.mp3')) throw errno('EXDEV');
      return real();
    };
    expect((await run(bookFiles('11.mp3', '12.mp3', '13.mp3'))).kind).toBe('cannot');
    expect(fsState.opened).toHaveLength(5);
    expect(fsState.opened.every((handle) => handle.fd === -1)).toBe(true);
  });

  it('a source swapped during the pass is not linked, and the earlier links are removed', async () => {
    const files = bookFiles('01.mp3', '02.mp3', '03.mp3');
    placeState.hook = async (source, real) => {
      if (source.endsWith('02.mp3')) {
        fs.rmSync(source);
        fs.writeFileSync(source, 'audio 02.mp3');
      }
      return real();
    };
    expect(await run(files)).toMatchObject({ kind: 'cannot', refusal: { code: 'VERIFY' }, leftBehind: [] });
    for (const f of files) expect(fs.existsSync(f.target)).toBe(false);
    expect(nlink(files[0].source)).toBe(1);
  });

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

  const noLinkAttempted = () => { fsState.linkHook = async () => { throw new Error('link must not be attempted'); }; };

  it('a last file outside the download folders refuses the book before any link is made', async () => {
    const stray = path.join(base, 'stray.mp3');
    fs.writeFileSync(stray, 'stray');
    const [good] = bookFiles('01.mp3');
    noLinkAttempted();
    const outcome = await run([good, { source: stray, target: path.join(book, 'stray.mp3') }]);
    expect(outcome).toMatchObject({ kind: 'cannot', refusal: { code: 'OUTSIDE', words: 'the files are not in a download folder' } });
    expect(fs.readdirSync(book)).toEqual([]);
  });

  it('a source whose folder is a link leading out of the download folders refuses the book', async () => {
    const outside = path.join(base, 'secret');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'x.mp3'), 'secret');
    fs.symlinkSync(outside, path.join(downloads, 'Torrent', 'escape'), 'junction');
    const source = path.join(downloads, 'Torrent', 'escape', 'x.mp3');
    expect(await run([{ source, target: path.join(book, 'x.mp3') }])).toMatchObject({ kind: 'cannot', refusal: { code: 'OUTSIDE' } });
    expect(fs.existsSync(path.join(book, 'x.mp3'))).toBe(false);
  });

  it('a third file that is a symbolic link refuses the book; the first two are never linked', async () => {
    const files = bookFiles('01.mp3', '02.mp3', '03.mp3');
    fsState.fakeSymlinks.add(path.resolve(files[2].source));
    noLinkAttempted();
    expect(await run(files)).toMatchObject({ kind: 'cannot', refusal: { code: 'SYMLINK' } });
    expect(fs.readdirSync(book)).toEqual([]);
    for (const f of files) expect(nlink(f.source)).toBe(1);
  });

  it.each([['symlink first', 0], ['symlink second', 1]])('every file is vetted whatever the order (%s), even when the devices differ', async (_label, at) => {
    const files = bookFiles('01.mp3', '02.mp3');
    fsState.fakeSymlinks.add(path.resolve(files[at as number].source));
    fsState.devOverride = { path: path.resolve(book), dev: BigInt(424242) };
    expect(await run(files)).toMatchObject({ kind: 'cannot', refusal: { code: 'SYMLINK' } });
  });

  it('a source that is not a regular file refuses the book', async () => {
    const dir = path.join(downloads, 'Torrent', 'folder.mp3');
    fs.mkdirSync(dir);
    const [good] = bookFiles('01.mp3');
    noLinkAttempted();
    expect(await run([good, { source: dir, target: path.join(book, 'folder.mp3') }])).toMatchObject({ kind: 'cannot', refusal: { code: 'NOT_REGULAR' } });
  });

  it.skipIf(process.platform === 'win32')('a real symlinked download file refuses the book', async () => {
    const real = download('real.mp3');
    const source = path.join(downloads, 'Torrent', 'link.mp3');
    fs.symlinkSync(real, source);
    expect(await run([{ source, target: path.join(book, 'link.mp3') }])).toMatchObject({ kind: 'cannot', refusal: { code: 'SYMLINK' } });
    expect(fs.existsSync(path.join(book, 'link.mp3'))).toBe(false);
  });

  it('a plain error on file 3 of 5 removes the first two links and stops the pass', async () => {
    const files = bookFiles('01.mp3', '02.mp3', '03.mp3', '04.mp3', '05.mp3');
    const tried: string[] = [];
    fsState.linkHook = async (source, _target, real) => {
      tried.push(path.basename(source));
      if (source.endsWith('03.mp3')) throw errno('EACCES');
      return real();
    };
    expect(await run(files)).toMatchObject({ kind: 'cannot', refusal: { code: 'EACCES', words: 'permission denied' }, leftBehind: [] });
    expect(tried).toEqual(['01.mp3', '02.mp3', '03.mp3']);
    expect(fs.readdirSync(book)).toEqual([]);
    for (const f of files) expect(nlink(f.source)).toBe(1);
  });

  it('a throw from placeFile after its link was made removes every link of this run, that one too', async () => {
    const files = bookFiles('01.mp3', '02.mp3', '03.mp3');
    placeState.hook = async (source, real) => {
      const placed = await real();
      if (source.endsWith('03.mp3')) throw new Error('boom');
      return placed;
    };
    expect(await run(files)).toMatchObject({ kind: 'cannot', refusal: { code: 'ERROR' }, leftBehind: [] });
    expect(fs.readdirSync(book)).toEqual([]);
    for (const f of files) expect(nlink(f.source)).toBe(1);
  });

  it('a name that cannot be removed again is reported in leftBehind and left as it is', async () => {
    const files = bookFiles('01.mp3', '02.mp3');
    fsState.linkHook = async (source, _target, real) => {
      await real();
      // A verification that fails and a name that can't be removed: a folder now stands at 02.mp3
      if (source.endsWith('02.mp3')) {
        fs.rmSync(files[1].target);
        fs.mkdirSync(files[1].target);
        fs.writeFileSync(path.join(files[1].target, 'keep'), 'x');
      }
    };
    const outcome = await run(files);
    expect(outcome).toMatchObject({ kind: 'cannot', refusal: { code: 'VERIFY' }, leftBehind: ['02.mp3'] });
    expect(fs.existsSync(files[0].target)).toBe(false);
    expect(fs.existsSync(path.join(files[1].target, 'keep'))).toBe(true);
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
