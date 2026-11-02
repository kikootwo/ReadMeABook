/**
 * Component: Multi-Disc Folder Rule Tests (real filesystem)
 * Documentation: documentation/features/multi-disc-folders.md
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probeState = vi.hoisted(() => ({ base: '', tracks: new Map<string, number>(), calls: [] as string[], active: 0, peak: 0 }));
vi.mock('@/lib/utils/chapter-merger', () => ({
  probeAudioFile: vi.fn(async (filePath: string) => {
    probeState.calls.push(filePath);
    probeState.active++;
    probeState.peak = Math.max(probeState.peak, probeState.active);
    await new Promise((r) => setTimeout(r, 2));
    probeState.active--;
    const key = path.relative(probeState.base, filePath);
    const track = probeState.tracks.get(key.split(path.sep).join('/'));
    if (track === -1) throw new Error('probe failed');
    return { duration: 1000, trackNumber: track };
  }),
}));

import {
  InPlaceDiscImportError,
  orderDiscImport,
  resolveDiscBook,
  resolveManualSelection,
} from '@/lib/utils/disc-layout-fs';
import type { RMABLogger } from '@/lib/utils/logger';

let root: string;

function mkfile(rel: string, base = root): string {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'audio');
  return full;
}

function trySymlink(target: string, link: string, type: 'dir' | 'file' | 'junction'): boolean {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-discs-')));
  probeState.base = '';
  probeState.tracks = new Map();
  probeState.calls = [];
  probeState.peak = 0;
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('resolveDiscBook', () => {
  it('lists the folder\'s own audio and each disc folder\'s direct audio, in import order', async () => {
    const book = path.join(root, 'Book');
    ['Disc 2/01.m4a', 'Disc 1/02.m4a', 'Disc 1/01.m4a', 'Disc 10/01.m4a', 'Intro.m4a', 'Extras/x.m4a', 'Disc 1/cover.jpg']
      .forEach((f) => mkfile(f, book));
    const found = await resolveDiscBook(book, [root]);
    expect(found?.files).toEqual(['Intro.m4a', 'Disc 1/01.m4a', 'Disc 1/02.m4a', 'Disc 2/01.m4a', 'Disc 10/01.m4a']);
  });

  it('builds paths from the raw folder name (trailing space kept)', async () => {
    const book = path.join(root, 'Book');
    mkfile('CD1 /01.mp3', book);
    mkfile('CD2/01.mp3', book);
    expect((await resolveDiscBook(book, []))?.files).toEqual(['CD1 /01.mp3', 'CD2/01.mp3']);
  });

  it('one disc folder, or audio only deeper than the disc folders, is not a disc book', async () => {
    mkfile('One/CD1/01.mp3');
    mkfile('Deep/CD1/Unabridged/01.mp3');
    mkfile('Deep/CD2/Unabridged/01.mp3');
    expect(await resolveDiscBook(path.join(root, 'One'), [])).toBeNull();
    expect(await resolveDiscBook(path.join(root, 'Deep'), [])).toBeNull();
  });

  it('a configured root never qualifies, also when named through a link', async () => {
    mkfile('Lib/CD1/01.mp3');
    mkfile('Lib/CD2/01.mp3');
    const lib = path.join(root, 'Lib');
    expect(await resolveDiscBook(lib, [lib])).toBeNull();
    const link = path.join(root, 'lib-link');
    if (trySymlink(lib, link, 'junction')) {
      expect(await resolveDiscBook(lib, [link])).toBeNull();
      expect(await resolveDiscBook(link, [lib])).toBeNull();
    }
  });

  it('never follows a symlinked disc folder or a symlinked audio file', async (ctx) => {
    const outside = path.join(root, 'outside');
    mkfile('CD9/01.mp3', outside);
    const secret = mkfile('secret.mp3', outside);
    const book = path.join(root, 'Book');
    mkfile('CD1/01.mp3', book);
    if (!trySymlink(path.join(outside, 'CD9'), path.join(book, 'CD2'), 'junction')) ctx.skip();
    // Only CD1 is real: not a disc book
    expect(await resolveDiscBook(book, [])).toBeNull();
    mkfile('CD3/01.mp3', book);
    const fileLinked = trySymlink(secret, path.join(book, 'CD3', '02.mp3'), 'file');
    const found = await resolveDiscBook(book, []);
    expect(found?.files).toEqual(['CD1/01.mp3', 'CD3/01.mp3']);
    if (!fileLinked) expect(fs.existsSync(path.join(book, 'CD3', '02.mp3'))).toBe(false);
  });
});

describe('resolveManualSelection', () => {
  let book: string;
  beforeEach(() => {
    book = path.join(root, 'Book');
    ['Disc 1/01.m4a', 'Disc 1/02.m4a', 'Disc 2/01.m4a', 'Extras/x.m4a'].forEach((f) => mkfile(f, book));
  });

  it('no selectedFiles on a disc-only folder: the book set is filled in (Extras left out)', async () => {
    expect(await resolveManualSelection(book, undefined, [root])).toEqual({
      ok: true, files: ['Disc 1/01.m4a', 'Disc 1/02.m4a', 'Disc 2/01.m4a'], audioFileCount: 3,
    });
  });

  it('no selectedFiles on a folder with its own audio: unchanged (the organizer walks it)', async () => {
    mkfile('Intro.m4a', book);
    expect(await resolveManualSelection(book, undefined, [root])).toEqual({ ok: true, files: [], audioFileCount: 1 });
  });

  it('no audio anywhere in the book: 400', async () => {
    const empty = path.join(root, 'Empty');
    mkfile('Extras/a.txt', empty);
    expect(await resolveManualSelection(empty, undefined, [])).toMatchObject({ ok: false, status: 400 });
  });

  it('the scan root itself never qualifies through the disc rule', async () => {
    expect(await resolveManualSelection(book, undefined, [book])).toMatchObject({ ok: false, status: 400 });
    expect(await resolveManualSelection(book, ['Disc 1/01.m4a'], [book])).toMatchObject({ ok: false, status: 400 });
  });

  it('accepts disc entries in the book set', async () => {
    expect(await resolveManualSelection(book, ['Disc 2/01.m4a', 'Disc 1/01.m4a'], [root])).toEqual({
      ok: true, files: ['Disc 2/01.m4a', 'Disc 1/01.m4a'], audioFileCount: 2,
    });
  });

  it.each([
    'Disc 1/../Disc 2/01.m4a', '../Book/Disc 1/01.m4a', '/Disc 1/01.m4a', 'Disc 1\\01.m4a', './Disc 1/01.m4a',
    'Disc 1//01.m4a', 'Disc 1/01.m4a\0', 'Extras/x.m4a', 'Disc 3/01.m4a',
  ])('refuses %j with a 400', async (entry) => {
    expect(await resolveManualSelection(book, [entry], [root])).toEqual({
      ok: false, status: 400, error: `Invalid file name: ${entry}`,
    });
  });

  it('entries without a / keep the stat check: a root-level symlinked audio file still passes', async () => {
    const target = mkfile('elsewhere/real.m4a');
    mkfile('Own.m4a', book);
    const linked = trySymlink(target, path.join(book, 'Linked.m4a'), 'file');
    const files = linked ? ['Own.m4a', 'Linked.m4a'] : ['Own.m4a'];
    expect(await resolveManualSelection(book, files, [root])).toEqual({ ok: true, files, audioFileCount: files.length });
    expect(await resolveManualSelection(book, ['Missing.m4a'], [root])).toMatchObject({ ok: false, status: 404 });
    expect(await resolveManualSelection(book, ['notes.txt'], [root])).toMatchObject({ ok: false, status: 400 });
    expect(await resolveManualSelection(book, ['..'], [root])).toMatchObject({ ok: false, status: 400 });
  });
});

describe('orderDiscImport', () => {
  const native = (keys: string[]) => keys.map((k) => k.split('/').join(path.sep));

  it('returns null for single-folder and non-disc layouts (their order is kept)', async () => {
    const target = path.join(root, 'media', 'Book');
    expect(await orderDiscImport(root, native(['02.mp3', '01.mp3']), { targetPath: target })).toBeNull();
    expect(await orderDiscImport(root, native(['CD1/02.mp3', 'CD1/01.mp3']), { targetPath: target })).toBeNull();
    expect(probeState.calls).toEqual([]);
  });

  it('orders disc by disc using per-disc track tags, with bounded probes', async () => {
    const src = path.join(root, 'src');
    probeState.base = src;
    const keys: string[] = [];
    for (let d = 1; d <= 3; d++) {
      for (let t = 1; t <= 4; t++) {
        keys.push(`CD${d}/t${t}.mp3`);
        probeState.tracks.set(`CD${d}/t${t}.mp3`, 5 - t); // tags reverse the names
      }
    }
    const ordered = await orderDiscImport(src, native([...keys].reverse()), { targetPath: path.join(root, 'media') });
    expect(ordered?.order).toEqual(native(['CD1/t4.mp3', 'CD1/t3.mp3', 'CD1/t2.mp3', 'CD1/t1.mp3',
      'CD2/t4.mp3', 'CD2/t3.mp3', 'CD2/t2.mp3', 'CD2/t1.mp3', 'CD3/t4.mp3', 'CD3/t3.mp3', 'CD3/t2.mp3', 'CD3/t1.mp3']));
    expect(probeState.peak).toBeLessThanOrEqual(4);
  });

  it('a failed probe falls back to natural order for that disc', async () => {
    const src = path.join(root, 'src');
    probeState.base = src;
    probeState.tracks.set('CD1/b.mp3', 1);
    probeState.tracks.set('CD1/a.mp3', -1);
    const ordered = await orderDiscImport(src, native(['CD2/a.mp3', 'CD1/b.mp3', 'CD1/a.mp3']), { targetPath: root });
    expect(ordered?.order).toEqual(native(['CD1/a.mp3', 'CD1/b.mp3', 'CD2/a.mp3']));
  });

  it('track tags that run across the book (CD2 continues CD1) order every disc', async () => {
    const src = path.join(root, 'src');
    probeState.base = src;
    // Chapter-title names that do not sort in play order
    const tracks: Record<string, number> = {
      'CD1/Prologue.mp3': 1, 'CD1/A Storm.mp3': 2, 'CD1/Kingdoms.mp3': 3,
      'CD2/Exile.mp3': 4, 'CD2/Crowns.mp3': 5, 'CD2/Epilogue.mp3': 6,
    };
    Object.entries(tracks).forEach(([k, t]) => probeState.tracks.set(k, t));
    const ordered = await orderDiscImport(src, native(Object.keys(tracks).sort()), { targetPath: path.join(root, 'media') });
    expect(ordered?.order).toEqual(native(Object.keys(tracks)));
  });

  it('probes the root files too: a root intro tagged 1 with the discs continuing orders and tags by the source tags', async () => {
    const src = path.join(root, 'src');
    probeState.base = src;
    const tracks: Record<string, number> = {
      'Opening.mp3': 1, 'CD1/The Shire.mp3': 2, 'CD1/A Party.mp3': 3, 'CD2/Bree.mp3': 4, 'CD2/Amon Hen.mp3': 5,
    };
    Object.entries(tracks).forEach(([k, t]) => probeState.tracks.set(k, t));
    const ordered = await orderDiscImport(src, native(Object.keys(tracks).sort()), { targetPath: path.join(root, 'media') });
    expect(probeState.calls).toHaveLength(5);
    expect(ordered?.order).toEqual(native(Object.keys(tracks)));
    expect(ordered?.tags.get(native(['CD1/The Shire.mp3'])[0])).toEqual({ disc: '1/2', track: '2/5' });
  });

  it('logs a whole-book tag order as such: no disc-by-disc line, no shared-number warning', async () => {
    const src = path.join(root, 'src');
    probeState.base = src;
    ['CD1/b.mp3', 'Disc 1/a.mp3', 'CD2/c.mp3'].forEach((k, i) => probeState.tracks.set(k, i + 1));
    const logger = { info: vi.fn(async () => undefined), warn: vi.fn(async () => undefined) };
    await orderDiscImport(src, native(['CD2/c.mp3', 'Disc 1/a.mp3', 'CD1/b.mp3']), {
      targetPath: path.join(root, 'media'), logger: logger as unknown as RMABLogger,
    });
    expect(logger.info.mock.calls.map((c) => c[0])).toEqual(['Multi-disc layout: 3 disc folders, 3 files ordered by their track tags across the whole book']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('gives each file its disc (d/D) and its track across the book (n/N), root files on the first disc', async () => {
    const src = path.join(root, 'src');
    const ordered = await orderDiscImport(src, native(['CD2/01.mp3', 'Intro.mp3', 'CD1/02.mp3', 'CD1/01.mp3']), {
      targetPath: path.join(root, 'media'),
    });
    expect(ordered?.order).toEqual(native(['Intro.mp3', 'CD1/01.mp3', 'CD1/02.mp3', 'CD2/01.mp3']));
    expect([...ordered!.tags]).toEqual([
      [native(['Intro.mp3'])[0], { disc: '1/2', track: '1/4' }],
      [native(['CD1/01.mp3'])[0], { disc: '1/2', track: '2/4' }],
      [native(['CD1/02.mp3'])[0], { disc: '1/2', track: '3/4' }],
      [native(['CD2/01.mp3'])[0], { disc: '2/2', track: '4/4' }],
    ]);
  });

  describe('in-place guard (Manual/Bulk Import)', () => {
    const files = native(['CD1/01.mp3', 'CD2/01.mp3']);
    let lib: string;
    beforeEach(() => {
      lib = path.join(root, 'media', 'Author', 'Book');
      files.forEach((f) => mkfile(f, lib));
    });

    it('stops when the source is the target, before any probe', async () => {
      await expect(orderDiscImport(lib, files, { targetPath: lib, stopInPlace: true })).rejects.toThrow(/nothing was changed/);
      expect(probeState.calls).toEqual([]);
    });

    it('stops a one-disc subset, and a root file plus one disc, of the library folder', async () => {
      mkfile('CD1/02.mp3', lib);
      mkfile('Intro.mp3', lib);
      for (const subset of [['CD1/01.mp3', 'CD1/02.mp3'], ['CD1/01.mp3'], ['Intro.mp3', 'CD1/01.mp3']]) {
        await expect(orderDiscImport(lib, native(subset), { targetPath: lib, stopInPlace: true, selectedFiles: subset }))
          .rejects.toBeInstanceOf(InPlaceDiscImportError);
      }
      expect(probeState.calls).toEqual([]);
    });

    it('a one-disc subset from a download folder is not stopped (single folder: the order is kept)', async () => {
      const download = path.join(root, 'downloads', 'Book');
      files.forEach((f) => mkfile(f, download));
      const subset = ['CD1/01.mp3'];
      expect(await orderDiscImport(download, native(subset), { targetPath: lib, stopInPlace: true, selectedFiles: subset }))
        .toBeNull();
    });

    it("a selection of the library folder's own files only is not stopped (single folder)", async () => {
      mkfile('Own.mp3', lib);
      expect(await orderDiscImport(lib, ['Own.mp3'], { targetPath: lib, stopInPlace: true, selectedFiles: ['Own.mp3'] }))
        .toBeNull();
    });

    it('stops when the source sits inside the target', async () => {
      const inner = path.join(lib, 'Rip');
      files.forEach((f) => mkfile(f, inner));
      await expect(orderDiscImport(inner, files, { targetPath: lib, stopInPlace: true })).rejects.toBeInstanceOf(InPlaceDiscImportError);
    });

    it('stops for a differently-cased path on a case-insensitive filesystem', async (ctx) => {
      const upper = lib.toUpperCase();
      if (!fs.existsSync(upper) || upper === lib) ctx.skip();
      await expect(orderDiscImport(upper, files, { targetPath: lib, stopInPlace: true })).rejects.toBeInstanceOf(InPlaceDiscImportError);
    });

    it('stops for a source named through a symlink', async (ctx) => {
      const link = path.join(root, 'link-to-book');
      if (!trySymlink(lib, link, 'junction')) ctx.skip();
      await expect(orderDiscImport(link, files, { targetPath: lib, stopInPlace: true })).rejects.toBeInstanceOf(InPlaceDiscImportError);
    });

    it('a download (no stop requested) and a different target are not stopped', async () => {
      expect((await orderDiscImport(lib, files, { targetPath: lib }))?.order).toEqual(files);
      expect((await orderDiscImport(lib, files, { targetPath: path.join(root, 'media', 'Other'), stopInPlace: true }))?.order)
        .toEqual(files);
    });
  });
});
