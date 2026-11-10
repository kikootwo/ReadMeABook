/**
 * Component: Hard Link Publish (link a download file into the library and prove it)
 * Documentation: documentation/features/library-placement.md
 *
 * Writes no bytes: link() adds a name, and a failed check removes that name again.
 * Called by placeFile (organize-copy.ts) under its per-target lock.
 */

import * as fs from 'fs/promises';
import { LINK_UNSUPPORTED, type FileIdentity } from './copy-file';

/** A reason this book can't be hard-linked; the File placement decides what happens next. */
export interface LinkRefusal {
  /** errno code (EXDEV, EPERM, ...) or one of ours (VERIFY, PREFIX, ROOTS, TARGET, IN_LIBRARY). */
  code: string;
  /** Plain words for the log and the request message. */
  words: string;
}

const CODE_WORDS: Record<string, string> = {
  EXDEV: 'the download and library folders are separate mounts',
  EPERM: 'not permitted: the filesystem has no hard links, or the files belong to another user',
  ENOTSUP: 'the filesystem has no hard links',
  EOPNOTSUPP: 'the filesystem has no hard links',
  ENOSYS: 'the filesystem has no hard links',
  EMLINK: 'too many links to the download file',
  EINVAL: 'the filesystem refused the link',
  VERIFY: 'the link could not be verified',
  PREFIX: 'an interrupted copy of this file is in the library',
  ROOTS: 'the configured folders could not be read',
  TARGET: 'the book folder is outside the media folder',
  IN_LIBRARY: 'the download is inside the media folder',
};

export function linkRefusal(code: string): LinkRefusal {
  return { code, words: CODE_WORDS[code] ?? 'the link was refused' };
}

/** "the download and library folders are separate mounts (EXDEV)" */
export function describeRefusal(refusal: LinkRefusal): string {
  return `${refusal.words} (${refusal.code})`;
}

export type LinkOutcome =
  | { kind: 'linked' }
  /** The target name appeared meanwhile: the caller applies its existing-target rules. */
  | { kind: 'exists' }
  | { kind: 'refused'; refusal: LinkRefusal }
  /** Any other error (ENOENT, EACCES, EIO): a per-file failure, as a failed copy would be. */
  | { kind: 'failed'; reason: string };

async function identityOf(p: string): Promise<{ id: FileIdentity; file: boolean; nlink: bigint } | null> {
  try {
    const s = await fs.lstat(p, { bigint: true });
    return { id: { dev: s.dev, ino: s.ino }, file: s.isFile(), nlink: s.nlink };
  } catch {
    return null;
  }
}

const sameFileIdentity = (a: FileIdentity, b: FileIdentity) => a.dev === b.dev && a.ino !== BigInt(0) && a.ino === b.ino;

/**
 * Hard-link `source` at `target` (which must not exist) and verify the result against
 * `expected`, the source's identity captured at the precheck: the new name is a regular
 * file with that dev and inode and at least 2 links, and the source path still names
 * that file. This catches a source swapped after the precheck, mergerfs creating a
 * symlink on EXDEV, and filesystems reporting other inodes (CIFS noserverino): each
 * removes the exact name this call created, whatever it now looks like, and refuses.
 */
export async function linkInto(source: string, target: string, expected: FileIdentity): Promise<LinkOutcome> {
  try {
    await fs.link(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code || '';
    if (code === 'EEXIST') return { kind: 'exists' };
    if (LINK_UNSUPPORTED.has(code)) return { kind: 'refused', refusal: linkRefusal(code) };
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }

  const placed = await identityOf(target);
  const still = await identityOf(source);
  const verified =
    !!placed && placed.file && sameFileIdentity(placed.id, expected) && placed.nlink >= BigInt(2) &&
    !!still && still.file && sameFileIdentity(still.id, expected);
  if (verified) return { kind: 'linked' };

  try {
    await fs.unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { kind: 'failed', reason: `the link could not be verified and ${target} could not be removed again` };
    }
  }
  return { kind: 'refused', refusal: linkRefusal('VERIFY') };
}
