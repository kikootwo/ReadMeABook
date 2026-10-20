/**
 * Component: Atomic File Copy Utility Tests (real filesystem, injected failures)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as realFs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const failures = vi.hoisted(() => ({
  readAfterBytes: null as null | { bytes: number; code: string },
  renameCode: null as null | string,
  writeCode: null as null | string,
  syncCode: null as null | string,
  linkCode: null as null | string,
  dirSyncCode: null as null | string,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    createReadStream: (file: string) => {
      const fail = failures.readAfterBytes;
      if (!fail) return actual.createReadStream(file);
      // Emit the first bytes of the real file, then fail like an interrupted read
      const head = actual.readFileSync(file).subarray(0, fail.bytes);
      let sent = false;
      return new Readable({
        read() {
          if (!sent) {
            sent = true;
            this.push(head);
          } else {
            this.destroy(Object.assign(new Error(`${fail.code}: read interrupted`), { code: fail.code }));
          }
        },
      });
    },
  };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  const nodeFs = await import('fs');
  const actual_isDir = (p: string) => {
    try {
      return nodeFs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  return {
    ...actual,
    link: async (from: string, to: string) => {
      if (failures.linkCode) {
        throw Object.assign(new Error(`${failures.linkCode}: link not supported`), { code: failures.linkCode });
      }
      return actual.link(from, to);
    },
    rename: async (from: string, to: string) => {
      if (failures.renameCode) {
        throw Object.assign(new Error(`${failures.renameCode}: rename failed`), { code: failures.renameCode });
      }
      return actual.rename(from, to);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (failures.dirSyncCode && actual_isDir(String(args[0]))) {
        const code = failures.dirSyncCode;
        return new Proxy(handle, {
          get(target, prop, receiver) {
            if (prop === 'sync') return async () => { throw Object.assign(new Error(`${code}: dir sync failed`), { code }); };
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      }
      if (!String(args[0]).includes('.rmab-partial-')) return handle;
      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === 'write' && failures.writeCode) {
            return async () => { throw Object.assign(new Error(`${failures.writeCode}: write failed`), { code: failures.writeCode }); };
          }
          if (prop === 'sync' && failures.syncCode) {
            return async () => { throw Object.assign(new Error(`${failures.syncCode}: sync failed`), { code: failures.syncCode }); };
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

import { copyFile, PARTIAL_FILE_PATTERN, partialNameFor } from '@/lib/utils/copy-file';

let root: string;
const BYTES = Buffer.from('audio-frame-'.repeat(200000));

function partialsIn(dir: string): string[] {
  return realFs.readdirSync(dir).filter((name) => PARTIAL_FILE_PATTERN.test(name));
}

describe('copyFile (atomic)', () => {
  beforeEach(() => {
    root = realFs.realpathSync(realFs.mkdtempSync(path.join(os.tmpdir(), 'rmab-atomic-')));
    failures.readAfterBytes = null;
    failures.renameCode = null;
    failures.writeCode = null;
    failures.syncCode = null;
    failures.linkCode = null;
    failures.dirSyncCode = null;
  });

  afterEach(() => {
    realFs.rmSync(root, { recursive: true, force: true });
  });

  const setup = () => {
    const source = path.join(root, 'src.m4b');
    const destDir = path.join(root, 'lib');
    realFs.mkdirSync(destDir);
    realFs.writeFileSync(source, BYTES);
    return { source, destDir, dest: path.join(destDir, 'Book.m4b') };
  };

  it('copies every byte, renames into place, and leaves no partial file', async () => {
    const { source, destDir, dest } = setup();

    const result = await copyFile(source, dest);

    expect(result).toEqual({ bytes: BYTES.length, sameFile: false });
    expect(realFs.readFileSync(dest).equals(BYTES)).toBe(true);
    expect(partialsIn(destDir)).toEqual([]);
  });

  it.each(['EIO', 'EPERM', 'ENOENT'])('an interrupted read (%s) never leaves a file under the final name', async (code) => {
    const { source, destDir, dest } = setup();
    failures.readAfterBytes = { bytes: 4096, code };

    await expect(copyFile(source, dest)).rejects.toThrow(code);

    expect(realFs.existsSync(dest)).toBe(false);
    expect(partialsIn(destDir)).toEqual([]);
  });

  it('an interrupted copy over an existing file leaves that file untouched', async () => {
    const { source, destDir, dest } = setup();
    realFs.writeFileSync(dest, 'previous library copy');
    failures.readAfterBytes = { bytes: 4096, code: 'EIO' };

    await expect(copyFile(source, dest)).rejects.toThrow('EIO');

    expect(realFs.readFileSync(dest, 'utf8')).toBe('previous library copy');
    expect(partialsIn(destDir)).toEqual([]);
  });

  it.each(['write', 'sync'])('a failed %s is fatal and cleans up the partial', async (step) => {
    const { source, destDir, dest } = setup();
    if (step === 'write') failures.writeCode = 'ENOSPC';
    else failures.syncCode = 'EIO';

    await expect(copyFile(source, dest)).rejects.toThrow(step === 'write' ? 'ENOSPC' : 'EIO');

    expect(realFs.existsSync(dest)).toBe(false);
    expect(partialsIn(destDir)).toEqual([]);
  });

  it.each(['EXDEV', 'EBUSY', 'EACCES'])('a failed rename (%s) throws and never writes the final name directly', async (code) => {
    const { source, destDir, dest } = setup();
    realFs.writeFileSync(dest, 'previous library copy');
    failures.renameCode = code;

    await expect(copyFile(source, dest)).rejects.toThrow(code);

    expect(realFs.readFileSync(dest, 'utf8')).toBe('previous library copy');
    expect(partialsIn(destDir)).toEqual([]);
  });

  it('create mode publishes a new file and never overwrites an existing one (EEXIST)', async () => {
    const { source, destDir, dest } = setup();

    await expect(copyFile(source, dest, { mode: 'create' })).resolves.toEqual({ bytes: BYTES.length, sameFile: false });
    expect(realFs.readFileSync(dest).equals(BYTES)).toBe(true);

    realFs.writeFileSync(dest, 'another job got here first');
    await expect(copyFile(source, dest, { mode: 'create' })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(realFs.readFileSync(dest, 'utf8')).toBe('another job got here first');
    expect(partialsIn(destDir)).toEqual([]);
  });

  it('create mode falls back to a checked rename where hard links are not supported', async () => {
    const { source, destDir, dest } = setup();
    failures.linkCode = 'EPERM';

    await copyFile(source, dest, { mode: 'create' });
    expect(realFs.readFileSync(dest).equals(BYTES)).toBe(true);

    realFs.writeFileSync(dest, 'existing');
    await expect(copyFile(source, dest, { mode: 'create' })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(realFs.readFileSync(dest, 'utf8')).toBe('existing');
    expect(partialsIn(destDir)).toEqual([]);
  });

  it('a failed folder fsync is accepted when the published file holds the source bytes', async () => {
    const { source, dest } = setup();
    failures.dirSyncCode = 'EIO';

    await expect(copyFile(source, dest)).resolves.toMatchObject({ sameFile: false });
    expect(realFs.readFileSync(dest).equals(BYTES)).toBe(true);
  });

  it('keeps partial names bounded and matching the pattern for very long target names', () => {
    const name = `${'a'.repeat(240)}.m4b`;
    const partial = partialNameFor(name);
    expect(PARTIAL_FILE_PATTERN.test(partial)).toBe(true);
    expect(partial.length).toBeLessThan(60);
  });
});
