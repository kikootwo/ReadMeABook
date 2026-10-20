/**
 * Component: Delete Safety Guard Tests (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertSafeToDelete, DeleteGuardContext, normalizeGuardPath, UnsafeDeleteError } from '@/lib/utils/delete-guard';

let root: string;

function dir(...parts: string[]): string {
  const p = path.join(root, ...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** Link `link` to `target` as a junction on Windows, a directory symlink elsewhere. */
function linkDir(target: string, link: string): void {
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

async function expectRefused(candidate: string, ctx: DeleteGuardContext, reason: RegExp) {
  const err = await assertSafeToDelete(candidate, ctx).then(() => null, (e) => e);
  expect(err).toBeInstanceOf(UnsafeDeleteError);
  expect((err as UnsafeDeleteError).reason).toMatch(reason);
}

describe('assertSafeToDelete', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-guard-')));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('separate download and media roots', () => {
    let ctx: DeleteGuardContext;
    let downloads: string;
    let media: string;
    let target: string;

    beforeEach(() => {
      downloads = dir('downloads');
      media = dir('media');
      target = dir('media', 'Author', 'Book');
      ctx = { targetPath: target, mediaDir: media, downloadRoots: [downloads], otherRoots: [dir('bookdrop')] };
    });

    it('allows a download folder inside the download dir', async () => {
      await expect(assertSafeToDelete(dir('downloads', 'Book.Name'), ctx)).resolves.toEqual(expect.any(String));
    });

    it('allows a download path that no longer exists', async () => {
      await expect(assertSafeToDelete(path.join(downloads, 'gone', 'Book.Name'), ctx)).resolves.toEqual(expect.any(String));
    });

    it.each([
      ['the target itself', () => target, /is the organize target/],
      ['a parent of the target', () => path.join(media, 'Author'), /contains the organize target/],
      ['a file inside the target', () => path.join(target, 'Book.m4b'), /inside the organize target/],
      ['the media root', () => media, /configured root|contains the organize target/],
      ['the download root', () => downloads, /is a configured root/],
      ['the bookdrop root', () => path.join(root, 'bookdrop'), /is a configured root/],
      ['a folder containing every root', () => root, /contains/],
      ['another library folder', () => dir('media', 'Other', 'Book'), /inside the media library/],
      ['an empty path', () => '', /empty path/],
    ])('refuses %s', async (_label, candidate, reason) => {
      await expectRefused(candidate(), ctx, reason);
    });

    it('allows another library folder when media sources are allowed, but still never the target', async () => {
      const other = dir('media', 'Other', 'Book');
      await expect(assertSafeToDelete(other, { ...ctx, allowMediaSources: true })).resolves.toEqual(expect.any(String));
      await expectRefused(path.join(target, 'Book.m4b'), { ...ctx, allowMediaSources: true }, /inside the organize target/);
      await expectRefused(media, { ...ctx, allowMediaSources: true }, /configured root|organize target/);
    });

    it('does not treat a sibling with a shared prefix as inside the media dir', async () => {
      const sibling = dir('media2', 'Book');
      await expect(assertSafeToDelete(sibling, ctx)).resolves.toEqual(expect.any(String));
    });
  });

  describe('nested roots', () => {
    it('download root strictly inside the media dir: its downloads may be removed', async () => {
      const media = dir('media');
      const downloads = dir('media', '_downloads');
      const ctx = { targetPath: dir('media', 'Author', 'Book'), mediaDir: media, downloadRoots: [downloads] };

      await expect(assertSafeToDelete(dir('media', '_downloads', 'Book.Name'), ctx)).resolves.toEqual(expect.any(String));
      await expectRefused(dir('media', 'Other', 'Book'), ctx, /inside the media library/);
      await expectRefused(downloads, ctx, /is a configured root/);
    });

    it('download root containing the media dir does not exempt library folders', async () => {
      const data = dir('data');
      const media = dir('data', 'media', 'audiobooks');
      const ctx = { targetPath: dir('data', 'media', 'audiobooks', 'Author', 'Book'), mediaDir: media, downloadRoots: [data] };

      await expectRefused(dir('data', 'media', 'audiobooks', 'Other', 'Book'), ctx, /inside the media library/);
      await expectRefused(path.join(data, 'media'), ctx, /contains/);
      await expect(assertSafeToDelete(dir('data', 'torrents', 'Book.Name'), ctx)).resolves.toEqual(expect.any(String));
    });

    it('checks every download root, including per-client custom paths and mapped local paths', async () => {
      const media = dir('media');
      const ctx = {
        mediaDir: media,
        downloadRoots: [dir('downloads'), dir('downloads', 'sab'), dir('media', 'mapped')],
      };

      await expectRefused(path.join(root, 'downloads', 'sab'), ctx, /is a configured root/);
      await expect(assertSafeToDelete(dir('media', 'mapped', 'Book.Name'), ctx)).resolves.toEqual(expect.any(String));
    });
  });

  describe('links and identity', () => {
    it('refuses a library entry that is a link to a seeding folder (the link location is checked)', async () => {
      const seeding = dir('downloads', 'seed', 'Disc 1');
      const target = dir('media', 'Author', 'Book');
      const entry = path.join(target, 'Disc 1');
      linkDir(seeding, entry);
      const ctx = { targetPath: target, mediaDir: dir('media'), downloadRoots: [dir('downloads')], allowMediaSources: true };

      await expectRefused(entry, ctx, /the link: it is inside the organize target/);
    });

    it('refuses a library file that is a symlink to a seeding file', async (testCtx) => {
      const seeding = path.join(dir('downloads', 'seed'), 'Book.m4b');
      fs.writeFileSync(seeding, 'audio');
      const target = dir('media', 'Author', 'Book');
      const entry = path.join(target, 'Book.m4b');
      try {
        fs.symlinkSync(seeding, entry, 'file');
      } catch (error) {
        if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return testCtx.skip();
        throw error;
      }
      const ctx = { targetPath: target, mediaDir: dir('media'), downloadRoots: [dir('downloads')], allowMediaSources: true };

      await expectRefused(entry, ctx, /the link: it is inside the organize target/);
    });

    it('refuses a real library path when the media dir is configured through a link', async () => {
      const realMedia = dir('real-media');
      const linkedMedia = path.join(root, 'linked-media');
      linkDir(realMedia, linkedMedia);
      const ctx = { mediaDir: linkedMedia, downloadRoots: [dir('downloads')] };

      await expectRefused(dir('real-media', 'Author', 'Book'), ctx, /inside the media library/);
      await expectRefused(realMedia, ctx, /is a configured root/);
    });

    it('refuses the target reached through a different spelling (link)', async () => {
      const media = dir('media');
      const target = dir('media', 'Author', 'Book');
      const alias = path.join(root, 'alias');
      linkDir(path.join(media, 'Author'), alias);
      const ctx = { targetPath: path.join(alias, 'Book'), mediaDir: media, downloadRoots: [dir('downloads')], allowMediaSources: true };

      await expectRefused(target, ctx, /is the organize target/);
      await expectRefused(path.join(media, 'Author'), ctx, /contains the organize target/);
    });

    it('refuses the target spelled with different case on a case-insensitive filesystem', async () => {
      const media = dir('media');
      const target = dir('media', 'Author', 'Book');
      const caseVariant = path.join(media, 'author', 'book');
      if (!fs.existsSync(caseVariant)) {
        // Case-sensitive filesystem: the two spellings are different folders.
        return;
      }
      const ctx = { targetPath: caseVariant, mediaDir: media, downloadRoots: [dir('downloads')], allowMediaSources: true };
      await expectRefused(target, ctx, /is the organize target/);
    });
  });

  describe('path the caller acts on', () => {
    const toGuardForm = (p: string) => p.split(path.sep).join('/');

    it('returns the canonical path that was checked', async () => {
      const downloads = dir('downloads');
      const real = dir('downloads', 'real', 'Book.Name');
      const alias = path.join(downloads, 'alias');
      linkDir(path.join(downloads, 'real'), alias);
      const ctx = { mediaDir: dir('media'), downloadRoots: [downloads] };

      const result = await assertSafeToDelete(path.join(alias, 'sub', '..', 'Book.Name'), ctx);

      expect(result).toBe(toGuardForm(real));
    });

    it('returns the link itself when the candidate is a symlink', async () => {
      const downloads = dir('downloads');
      const realDir = dir('downloads', 'real');
      const link = path.join(downloads, 'link');
      linkDir(realDir, link);
      const ctx = { mediaDir: dir('media'), downloadRoots: [downloads] };

      const result = await assertSafeToDelete(link, ctx);

      expect(result).toBe(toGuardForm(link));
    });

    it('returns the link itself when the symlink candidate has a trailing separator', async () => {
      const downloads = dir('downloads');
      const realDir = dir('downloads', 'real');
      const link = path.join(downloads, 'link');
      linkDir(realDir, link);
      const ctx = { mediaDir: dir('media'), downloadRoots: [downloads] };

      expect(await assertSafeToDelete(`${link}/`, ctx)).toBe(toGuardForm(link));
      expect(await assertSafeToDelete(`${link}${path.sep}`, ctx)).toBe(toGuardForm(link));
    });
  });

  describe('drive roots', () => {
    it('normalizes a bare drive to its root', () => {
      expect(normalizeGuardPath('C:')).toBe('C:/');
      expect(normalizeGuardPath('C:/')).toBe('C:/');
      expect(normalizeGuardPath('/')).toBe('/');
    });

    it.runIf(process.platform === 'win32')('does not treat the current directory as an ancestor of every path', async () => {
      const target = dir('media', 'Author', 'Book');
      const ctx = { targetPath: target, mediaDir: dir('media'), downloadRoots: [dir('downloads')] };
      const previous = process.cwd();
      process.chdir(target);
      try {
        await expect(assertSafeToDelete(dir('downloads', 'Book.Name'), ctx)).resolves.toEqual(expect.any(String));
      } finally {
        process.chdir(previous);
      }
    });
  });
});
