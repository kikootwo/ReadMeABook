/**
 * Component: Verified File Placement Tests - permissions and fallback (real filesystem)
 * Documentation: documentation/phase3/file-organization.md
 *
 * mergerfs, NFS and FUSE mounts accept the copy but refuse chmod. The copy
 * must stand, with a warning, and no fallback may overwrite a copy that landed.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsHooks = vi.hoisted(() => ({
  chmodError: null as string | null,
  /** Path whose post-publish verification stat should fail once. */
  failVerifyStatFor: null as string | null,
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const errno = (code: string, syscall: string, p: string) =>
    Object.assign(new Error(`${code}: operation not permitted, ${syscall} '${p}'`), { code, syscall, path: p });
  const mocked = {
    ...actual,
    chmod: vi.fn(async (p: fs.PathLike, mode: fs.Mode) => {
      if (fsHooks.chmodError) throw errno(fsHooks.chmodError, 'chmod', String(p));
      return actual.chmod(p, mode);
    }),
    stat: vi.fn(async (p: fs.PathLike, opts?: any) => {
      if (opts?.bigint && fsHooks.failVerifyStatFor && String(p) === fsHooks.failVerifyStatFor) {
        fsHooks.failVerifyStatFor = null;
        throw errno('EIO', 'stat', String(p));
      }
      return actual.stat(p, opts);
    }),
  };
  return { ...mocked, default: mocked };
});

import { placeAudio, placeFile, applyFileMode } from '@/lib/utils/organize-copy';

let root: string;
const ORIGINAL = Buffer.from('original-audio-'.repeat(50000));
const TAGGED = Buffer.concat([Buffer.from('TAGGED-HEADER:'), ORIGINAL]);
const OPTS = { fileMode: 0o664, compareExisting: true };

function write(rel: string, data: Buffer): string {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
  return p;
}

describe('placement when the filesystem refuses chmod', () => {
  let original: string;
  let tagged: string;
  let target: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-perm-')));
    original = write('downloads/Book.m4b', ORIGINAL);
    tagged = write('tmp/Book.tagged.m4b', TAGGED);
    target = path.join(root, 'media', 'Author', 'Book', 'Book.m4b');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fsHooks.chmodError = null;
    fsHooks.failVerifyStatFor = null;
  });

  afterEach(() => {
    fsHooks.chmodError = null;
    fsHooks.failVerifyStatFor = null;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(['EPERM', 'ENOTSUP', 'EACCES'])('placeFile: %s from chmod keeps the copy as copied, with a warning', async (code) => {
    fsHooks.chmodError = code;

    const result = await placeFile(original, target, OPTS);

    expect(result.status).toBe('copied');
    expect(result.warning).toContain(target);
    expect(result.warning).toContain(code);
    expect(fs.readFileSync(target).equals(ORIGINAL)).toBe(true);
  });

  it('placeFile: no warning when chmod succeeds', async () => {
    const result = await placeFile(original, target, OPTS);

    expect(result).toEqual({ status: 'copied', target });
  });

  it.each(['EPERM', 'ENOTSUP'])('placeAudio: %s from chmod keeps the tagged copy; the original never overwrites it', async (code) => {
    fsHooks.chmodError = code;
    const probeDuration = vi.fn(async () => 60_000);

    const result = await placeAudio(original, tagged, target, { ...OPTS, probeDuration });

    expect(result).toMatchObject({ status: 'copied', verified: true, usedDerivative: true, target });
    expect(result.warning).toContain(code);
    expect(fs.readFileSync(target).equals(TAGGED)).toBe(true);
  });

  it('placeAudio: a tagged copy that landed but failed verification is never replaced by the original', async () => {
    // A derivative that is a byte-prefix of the original is the one shape the
    // interrupted-copy rule would re-copy over; the fallback must not.
    const prefixDerivative = write('tmp/Book.prefix.m4b', ORIGINAL.subarray(0, 4096));
    fsHooks.failVerifyStatFor = target;
    const probeDuration = vi.fn(async () => 60_000);

    const result = await placeAudio(original, prefixDerivative, target, { ...OPTS, probeDuration });

    // Our own unverified copy is at the target: failed, never "different content"
    expect(result.verified).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/^Tagged copy failed \(.*EIO.*\); original not placed \(.+\)$/);
    expect(fs.readFileSync(target).equals(ORIGINAL.subarray(0, 4096))).toBe(true);
  });

  it('placeAudio: a library file refused for different reasons stays differs, with both reasons', async () => {
    // Smaller than the tagged copy (and not its prefix), larger than the original
    const libraryFile = Buffer.concat([ORIGINAL, Buffer.from('other')]);
    fs.writeFileSync(target, libraryFile);
    const probeDuration = vi.fn(async () => 60_000);

    const result = await placeAudio(original, tagged, target, { ...OPTS, probeDuration });

    expect(result).toMatchObject({ status: 'differs', verified: false });
    expect(result.reason).toBe(
      'Tagged copy not placed (existing target is smaller and not a prefix of the source); original not placed (existing target is larger than the source)'
    );
    expect(fs.readFileSync(target).equals(libraryFile)).toBe(true);
  });

  it('placeAudio: a library file refused for the same reason both times gives that reason once', async () => {
    const libraryFile = Buffer.concat([ORIGINAL, Buffer.from('a longer, different library file')]);
    fs.writeFileSync(target, libraryFile);
    const probeDuration = vi.fn(async () => 60_000);

    const result = await placeAudio(original, tagged, target, { ...OPTS, probeDuration });

    expect(result).toMatchObject({ status: 'differs', verified: false });
    expect(result.reason).toBe('existing target is larger than the source');
    expect(fs.readFileSync(target).equals(libraryFile)).toBe(true);
  });

  it.each(['ENOENT', 'ENOTDIR'])('placeFile: %s from chmod means the file is not there: failed, never verified', async (code) => {
    fsHooks.chmodError = code;

    const result = await placeFile(original, target, OPTS);

    expect(result.status).toBe('failed');
    expect(result.reason).toContain(code);
    expect(result.warning).toBeUndefined();
  });

  it('placeAudio: a derivative that fails before landing still falls back to the original', async () => {
    const probeDuration = vi.fn(async () => 60_000);
    const missingDerivative = path.join(root, 'tmp', 'gone.m4b');

    const result = await placeAudio(original, missingDerivative, target, { ...OPTS, probeDuration });

    expect(result).toMatchObject({ status: 'copied', verified: true, usedDerivative: false });
    expect(fs.readFileSync(target).equals(ORIGINAL)).toBe(true);
  });
});

describe('applyFileMode', () => {
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rmab-perm-')));
  });

  afterEach(() => {
    fsHooks.chmodError = null;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('never throws on a refused chmod; the warning names the path, octal mode and error code', async () => {
    const file = write('cover.jpg', Buffer.from('jpg'));
    fsHooks.chmodError = 'EPERM';

    const outcome = await applyFileMode(file, 0o664);

    expect(outcome.kind).toBe('refused');
    const warning = outcome.kind === 'refused' ? outcome.warning : '';
    expect(warning).toContain(file);
    expect(warning).toContain('664');
    expect(warning).toContain('EPERM');
    expect(fs.existsSync(file)).toBe(true);
  });

  it.each(['ENOENT', 'ENOTDIR'])('reports %s as missing, not as a permission warning', async (code) => {
    fsHooks.chmodError = code;

    const outcome = await applyFileMode(path.join(root, 'cover.jpg'), 0o664);

    expect(outcome).toMatchObject({ kind: 'missing' });
  });

  it('reports applied when the mode is set', async () => {
    const file = write('cover.jpg', Buffer.from('jpg'));

    await expect(applyFileMode(file, 0o664)).resolves.toEqual({ kind: 'applied' });
  });
});
