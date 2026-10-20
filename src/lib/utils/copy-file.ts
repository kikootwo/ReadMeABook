/**
 * Component: Atomic File Copy Utility
 * Documentation: documentation/phase3/file-organization.md
 *
 * Copies through read()/write() via one FileHandle instead of fs.copyFile(),
 * which relies on copy_file_range(), a syscall that fails with EPERM on some
 * filesystems (e.g. cross-export NFS4 mounts). The copy goes to a hidden
 * partial file next to the destination, is fsynced and size-checked, and only
 * then renamed over the destination, so a crash never leaves a truncated file
 * under the final name.
 */

import { createReadStream } from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';

/** Minimal stat shape used for identity comparison (bigint stats). */
export interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

/**
 * True when two stat results describe the same filesystem entry.
 * An inode of 0 means the filesystem does not report one, so it never matches.
 */
export function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino !== BigInt(0) && a.ino === b.ino;
}

/**
 * True when both paths exist and refer to the same file or directory:
 * identical realpath, or same device and same (non-zero) inode. The inode
 * check catches hard links and case-insensitive mounts where two spellings
 * name one entry. Missing paths are never the same file.
 */
export async function isSameFile(a: string, b: string): Promise<boolean> {
  try {
    const [realA, realB] = await Promise.all([fsp.realpath(a), fsp.realpath(b)]);
    if (realA === realB) {
      return true;
    }
    const [statA, statB] = await Promise.all([
      fsp.stat(realA, { bigint: true }),
      fsp.stat(realB, { bigint: true }),
    ]);
    return sameIdentity(statA, statB);
  } catch {
    return false;
  }
}

// =========================================================================
// PARTIAL FILE NAMING
// =========================================================================

/** `.rmab-partial-<hash12(name)>-<rand>.part`: hidden, non-audio, bounded length. */
export const PARTIAL_FILE_PATTERN = /^\.rmab-partial-([0-9a-f]{12})-([0-9a-f]{8,32})\.part$/;

export function partialNameHash(targetName: string): string {
  return createHash('sha256').update(targetName).digest('hex').slice(0, 12);
}

export function partialNameFor(targetName: string): string {
  return `.rmab-partial-${partialNameHash(targetName)}-${randomBytes(8).toString('hex')}.part`;
}

// =========================================================================
// ATOMIC COPY
// =========================================================================

export interface CopyResult {
  /** Bytes in the destination after the copy. */
  bytes: number;
  /** True when source and destination were already the same file (nothing written). */
  sameFile: boolean;
}

export interface CopyOptions {
  /**
   * 'replace' (default): rename the finished copy over the destination.
   * 'create': publish only if the destination does not exist (hard link, no
   * overwrite); an existing destination fails with code EEXIST and is left untouched.
   */
  mode?: 'replace' | 'create';
}

/** Codes meaning the filesystem cannot hard-link here; 'create' then falls back to a checked rename. */
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EMLINK', 'EINVAL']);

function existsError(destination: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`EEXIST: ${path.basename(destination)} already exists`), { code: 'EEXIST' });
}

/** Rejects a pending in-process publish to the same path; see publishCreate's fallback. */
const publishing = new Set<string>();

async function unlinkQuietly(filePath: string): Promise<void> {
  try {
    await fsp.unlink(filePath);
  } catch {
    // Already gone
  }
}

/** Best-effort directory fsync so the publish is durable; unsupported platforms are ignored. */
async function syncDirectory(dir: string): Promise<void> {
  let handle: fsp.FileHandle | undefined;
  try {
    handle = await fsp.open(dir, 'r');
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EBADF', 'EPERM', 'EACCES'].includes(code || '')) {
      throw error;
    }
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Publish `partial` at `destination` without ever overwriting it: hard-link
 * (fails with EEXIST when the destination appeared meanwhile), then drop the
 * partial name. Filesystems without hard links fall back to an lstat check
 * and rename, serialized in-process per destination.
 */
async function publishCreate(partial: string, destination: string): Promise<void> {
  try {
    await fsp.link(partial, destination);
    await unlinkQuietly(partial);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code || '';
    if (code === 'EEXIST') {
      await unlinkQuietly(partial);
      throw existsError(destination);
    }
    if (!LINK_UNSUPPORTED.has(code)) {
      await unlinkQuietly(partial);
      throw error;
    }
  }

  const key = path.resolve(destination);
  if (publishing.has(key)) {
    await unlinkQuietly(partial);
    throw existsError(destination);
  }
  publishing.add(key);
  try {
    try {
      await fsp.lstat(destination);
      await unlinkQuietly(partial);
      throw existsError(destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await fsp.rename(partial, destination);
    } catch (error) {
      await unlinkQuietly(partial);
      throw error;
    }
  } finally {
    publishing.delete(key);
  }
}

/**
 * Copy `source` to `destination` atomically.
 *
 * Write, fsync and close of the partial file are all fatal. The partial must
 * hold exactly the source's size before it is published; afterwards the
 * destination must have that size and the partial's identity (or, if the
 * identity changed or the folder fsync failed, the source's exact bytes). A
 * failed rename or link (EXDEV, EBUSY, EACCES, ...) throws and never falls back
 * to writing the destination in place. With mode 'create' an existing
 * destination is never overwritten (EEXIST). When source and destination are
 * the same file this is a no-op: opening the destination for writing would
 * truncate the source.
 */
export async function copyFile(source: string, destination: string, options: CopyOptions = {}): Promise<CopyResult> {
  if (await isSameFile(source, destination)) {
    const stat = await fsp.stat(source);
    return { bytes: stat.size, sameFile: true };
  }

  const sourceStat = await fsp.stat(source);
  const dir = path.dirname(destination);
  const partial = path.join(dir, partialNameFor(path.basename(destination)));

  let bytes = 0;
  const handle = await fsp.open(partial, 'wx');
  try {
    for await (const chunk of createReadStream(source)) {
      const buffer = chunk as Buffer;
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset);
        offset += bytesWritten;
      }
      bytes += buffer.length;
    }
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlinkQuietly(partial);
    throw error;
  }

  try {
    await handle.close();
  } catch (error) {
    await unlinkQuietly(partial);
    throw error;
  }

  const partialStat = await fsp.stat(partial, { bigint: true });
  if (bytes !== sourceStat.size || partialStat.size !== BigInt(sourceStat.size)) {
    await unlinkQuietly(partial);
    throw new Error(`Copy incomplete: wrote ${bytes} of ${sourceStat.size} bytes for ${path.basename(destination)}`);
  }

  if (options.mode === 'create') {
    await publishCreate(partial, destination);
  } else {
    try {
      await fsp.rename(partial, destination);
    } catch (error) {
      await unlinkQuietly(partial);
      throw error;
    }
  }

  const finalStat = await fsp.stat(destination, { bigint: true });
  const identityChanged =
    partialStat.ino !== BigInt(0) && (finalStat.ino !== partialStat.ino || finalStat.dev !== partialStat.dev);
  if (finalStat.size !== partialStat.size || identityChanged) {
    // Some filesystems report a new inode after rename; trust only the exact bytes
    if (!(await filesEqual(source, destination))) {
      throw new Error(`Copy verification failed after publishing ${path.basename(destination)}`);
    }
  }

  try {
    await syncDirectory(dir);
  } catch (error) {
    if (!(await filesEqual(source, destination))) throw error;
  }
  return { bytes, sameFile: false };
}

// =========================================================================
// CONTENT COMPARISON
// =========================================================================

const COMPARE_CHUNK = 1024 * 1024;

/**
 * Compare the first `length` bytes of two files in chunks, stopping at the
 * first difference. Both files must hold at least `length` bytes.
 */
export async function sameLeadingBytes(a: string, b: string, length: number): Promise<boolean> {
  const ha = await fsp.open(a, 'r');
  let hb: fsp.FileHandle;
  try {
    hb = await fsp.open(b, 'r');
  } catch (error) {
    await ha.close().catch(() => undefined);
    throw error;
  }
  try {
    const bufA = Buffer.alloc(COMPARE_CHUNK);
    const bufB = Buffer.alloc(COMPARE_CHUNK);
    let position = 0;
    while (position < length) {
      const want = Math.min(COMPARE_CHUNK, length - position);
      const [ra, rb] = await Promise.all([
        ha.read(bufA, 0, want, position),
        hb.read(bufB, 0, want, position),
      ]);
      if (ra.bytesRead !== want || rb.bytesRead !== want) return false;
      if (!bufA.subarray(0, want).equals(bufB.subarray(0, want))) return false;
      position += want;
    }
    return true;
  } finally {
    await Promise.all([ha.close().catch(() => undefined), hb.close().catch(() => undefined)]);
  }
}

/** True when both files have the same size and bytes (chunked, stops at first difference). */
export async function filesEqual(a: string, b: string): Promise<boolean> {
  const [sa, sb] = await Promise.all([fsp.stat(a), fsp.stat(b)]);
  if (sa.size !== sb.size) return false;
  return sameLeadingBytes(a, b, sa.size);
}
