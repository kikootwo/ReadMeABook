/**
 * Component: Stream-based File Copy Utility
 * Documentation: documentation/phase3/file-organization.md
 *
 * Uses read()/write() syscalls via Node.js streams instead of fs.copyFile(),
 * which relies on copy_file_range() — a syscall that fails with EPERM on
 * certain filesystem configurations (e.g. cross-export NFS4 mounts).
 */

import { createReadStream, createWriteStream } from 'fs';
import * as fsp from 'fs/promises';
import { pipeline } from 'stream/promises';

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

/**
 * Copy a file using streams.
 *
 * Equivalent to `fs.copyFile()` but uses standard read/write syscalls
 * instead of `copy_file_range()`, ensuring compatibility with NFS, FUSE,
 * and other network/virtual filesystems.
 *
 * When source and destination are the same file this is a no-op: opening the
 * destination for writing would truncate the source before it is read.
 */
export async function copyFile(source: string, destination: string): Promise<void> {
  if (await isSameFile(source, destination)) {
    return;
  }
  await pipeline(createReadStream(source), createWriteStream(destination));
}
