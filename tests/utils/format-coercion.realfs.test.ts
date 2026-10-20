/**
 * Component: Plex Format Coercion Tests (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 *
 * The coercion rename must never replace a library file: not one that was
 * there before the import, not one another organize job places meanwhile.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Paths that "appear" (written by another job) the moment their absence is checked. */
const appearOnCheck = vi.hoisted(() => new Map<string, string>());
/** How unlink of a path fails once: 'vanish' = someone else removed it first (ENOENT), else that error code. */
const unlinkFailure = vi.hoisted(() => new Map<string, string>());

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  /** Write the other job's file now; true when it was due. */
  const land = (target: unknown): boolean => {
    const content = appearOnCheck.get(String(target));
    if (content === undefined) return false;
    appearOnCheck.delete(String(target));
    actual.writeFileSync(String(target), content);
    return true;
  };
  // An existence check sees nothing, and the file lands right after it
  const appear = (target: unknown) => {
    if (land(target)) {
      throw Object.assign(new Error('ENOENT: no such file or directory (checked just before it appeared)'), { code: 'ENOENT' });
    }
  };
  const promises = {
    ...actual.promises,
    unlink: async (target: fs.PathLike) => {
      const failure = unlinkFailure.get(String(target));
      if (failure === undefined) return actual.promises.unlink(target);
      unlinkFailure.delete(String(target));
      if (failure === 'vanish') {
        actual.unlinkSync(String(target));
        throw Object.assign(new Error('ENOENT: no such file or directory, unlink'), { code: 'ENOENT' });
      }
      throw Object.assign(new Error(`${failure}: simulated, unlink`), { code: failure });
    },
    // Without a check first, the file lands just before the operation runs
    link: async (from: fs.PathLike, to: fs.PathLike) => {
      land(to);
      return actual.promises.link(from, to);
    },
    rename: async (from: fs.PathLike, to: fs.PathLike) => {
      land(to);
      return actual.promises.rename(from, to);
    },
    access: async (target: fs.PathLike, mode?: number) => {
      appear(target);
      return actual.promises.access(target, mode);
    },
    lstat: (async (target: fs.PathLike, options?: fs.StatOptions) => {
      appear(target);
      return actual.promises.lstat(target, options as fs.StatOptions & { bigint?: false });
    }) as typeof actual.promises.lstat,
  };
  return { ...actual, promises, default: { ...actual, promises } };
});

import { coerceToPlexCompatible } from '@/lib/utils/format-coercion';
import { placeFile } from '@/lib/utils/organize-copy';

let root: string;
let lib: string;

function write(file: string, data: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}

function contentsOf(dir: string): string[] {
  return fs.readdirSync(dir).map((name) => fs.readFileSync(path.join(dir, name), 'utf8')).sort();
}

describe('coerceToPlexCompatible on a real filesystem', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-coerce-')));
    lib = path.join(root, 'media', 'Author', 'Book');
    fs.mkdirSync(lib, { recursive: true });
    appearOnCheck.clear();
    unlinkFailure.clear();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('renames a file this import placed, leaving no file under the old name', async () => {
    const mp4 = write(path.join(lib, 'Book.mp4'), 'placed-now');

    const result = await coerceToPlexCompatible([mp4], new Set([mp4]));

    expect(result.finalAudioFiles).toEqual([path.join(lib, 'Book.m4b')]);
    expect(fs.readdirSync(lib)).toEqual(['Book.m4b']);
    expect(fs.readFileSync(path.join(lib, 'Book.m4b'), 'utf8')).toBe('placed-now');
  });

  it('keeps an existing .m4b and the placed .mp4 when the target is already there', async () => {
    const mp4 = write(path.join(lib, 'Book.mp4'), 'placed-now');
    write(path.join(lib, 'Book.m4b'), 'library-original');

    const result = await coerceToPlexCompatible([mp4], new Set([mp4]));

    expect(result.renamed).toEqual([]);
    expect(result.finalAudioFiles).toEqual([mp4]);
    expect(fs.readFileSync(path.join(lib, 'Book.m4b'), 'utf8')).toBe('library-original');
    expect(fs.readFileSync(mp4, 'utf8')).toBe('placed-now');
  });

  it('never overwrites a .m4b another job places while the rename runs', async () => {
    const mp4 = write(path.join(lib, 'Book.mp4'), 'placed-by-this-job');
    appearOnCheck.set(path.join(lib, 'Book.m4b'), 'placed-by-the-other-job');

    const result = await coerceToPlexCompatible([mp4], new Set([mp4]));

    expect(contentsOf(lib)).toEqual(['placed-by-the-other-job', 'placed-by-this-job']);
    expect(fs.readFileSync(path.join(lib, 'Book.m4b'), 'utf8')).toBe('placed-by-the-other-job');
    expect(result.finalAudioFiles).toEqual([mp4]);
  });

  it('keeps both files when a concurrent placement of the .m4b runs alongside the rename', async () => {
    const mp4 = write(path.join(lib, 'Book.mp4'), 'placed-by-this-job');
    const otherSource = write(path.join(root, 'downloads', 'Other', 'Book.m4b'), 'placed-by-the-other-job-longer');

    const [coercion, placement] = await Promise.all([
      coerceToPlexCompatible([mp4], new Set([mp4])),
      placeFile(otherSource, path.join(lib, 'Book.m4b'), { fileMode: 0o664, compareExisting: true }),
    ]);

    // Whichever ran first, the other one saw its file and left it alone
    const libraryContents = contentsOf(lib);
    if (coercion.renamed.length > 0) {
      expect(placement.status).toBe('differs');
      expect(libraryContents).toEqual(['placed-by-this-job']);
    } else {
      expect(placement.status).toBe('copied');
      expect(libraryContents).toEqual(['placed-by-the-other-job-longer', 'placed-by-this-job']);
    }
  });

  it('never renames a library file this import did not place (an existing file that differs)', async () => {
    const existing = write(path.join(lib, 'Book.mp4'), 'library-original');

    const result = await coerceToPlexCompatible([existing], new Set());

    expect(result.renamed).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(fs.readdirSync(lib)).toEqual(['Book.mp4']);
    expect(fs.readFileSync(existing, 'utf8')).toBe('library-original');
  });

  it('counts existing .m4a files as siblings: a placed .m4a next to one is not a single-file book', async () => {
    const existing = write(path.join(lib, 'Chapter 1.m4a'), 'library-original');
    const placed = write(path.join(lib, 'Chapter 2.m4a'), 'placed-now');

    const result = await coerceToPlexCompatible([existing, placed], new Set([placed]));

    expect(result.renamed).toEqual([]);
    expect(fs.readdirSync(lib).sort()).toEqual(['Chapter 1.m4a', 'Chapter 2.m4a']);
  });

  it('finishes a rename that a crash stopped between link and unlink (both names on one file)', async () => {
    const mp4 = write(path.join(lib, 'Book.mp4'), 'placed-now');
    fs.linkSync(mp4, path.join(lib, 'Book.m4b'));

    const result = await coerceToPlexCompatible([mp4], new Set([mp4]));

    expect(result.renamed).toEqual([{ from: mp4, to: path.join(lib, 'Book.m4b') }]);
    expect(fs.readdirSync(lib)).toEqual(['Book.m4b']);
    expect(fs.readFileSync(path.join(lib, 'Book.m4b'), 'utf8')).toBe('placed-now');
  });

  it('keeps the new name when the old one is already gone at unlink', async () => {
    const mp4 = write(path.join(lib, 'Book.mp4'), 'placed-now');
    unlinkFailure.set(mp4, 'vanish');

    const result = await coerceToPlexCompatible([mp4], new Set([mp4]));

    expect(fs.readdirSync(lib)).toEqual(['Book.m4b']);
    expect(fs.readFileSync(path.join(lib, 'Book.m4b'), 'utf8')).toBe('placed-now');
    expect(result.finalAudioFiles).toEqual([path.join(lib, 'Book.m4b')]);
  });

  it('undoes the link when the old name cannot be removed, keeping the file under its placed name', async () => {
    const mp4 = write(path.join(lib, 'Book.mp4'), 'placed-now');
    unlinkFailure.set(mp4, 'EPERM');

    const result = await coerceToPlexCompatible([mp4], new Set([mp4]));

    expect(fs.readdirSync(lib)).toEqual(['Book.mp4']);
    expect(result.finalAudioFiles).toEqual([mp4]);
    expect(result.warnings.join(' ')).toContain('EPERM');
  });
});
