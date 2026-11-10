/**
 * Component: Hard Link Publish (link a download file into the library and prove it)
 * Documentation: documentation/features/library-placement.md
 *
 * Writes no bytes: link() adds a name, and a failed check removes that name again.
 * Called by placeFile (organize-copy.ts) under its per-target lock.
 */

import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import { LINK_UNSUPPORTED, sameIdentity, type FileIdentity } from './copy-file';

/** A reason this book can't be hard-linked; the File placement decides what happens next. */
export interface LinkRefusal {
  /** errno code (EXDEV, EPERM, EACCES, ...) or one of ours (VERIFY, PREFIX, ROOTS, TARGET, OUTSIDE, ...). */
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
  OUTSIDE: 'the files are not in a download folder',
  SYMLINK: 'a download file is a symbolic link',
  NOT_REGULAR: 'a download file is not a regular file',
  EACCES: 'permission denied',
  EIO: 'a read or write error',
  ENOENT: 'a file is missing',
  ERROR: 'the link failed',
};

/** Codes whose fix is the mounts (or the files' owner): the only ones the request message gives mount advice for. */
export const MOUNT_CODES: ReadonlySet<string> = new Set(['EXDEV', 'EPERM']);

export function linkRefusal(code: string): LinkRefusal {
  return { code, words: CODE_WORDS[code] ?? 'the link was refused' };
}

/** The refusal for a thrown error: its errno code when it has one, else ERROR. */
export function refusalFromError(error: unknown): LinkRefusal {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return linkRefusal(typeof code === 'string' && /^E[A-Z]+$/.test(code) ? code : 'ERROR');
}

/** "the download and library folders are separate mounts, EXDEV": the one format for logs, requests and the Paths page. */
export function describeRefusal(refusal: LinkRefusal): string {
  return `${refusal.words}, ${refusal.code}`;
}

/**
 * A source file held open for the link pass. Device and inode alone don't name a file over
 * time: Linux hands a freed inode number to the next new file at once, so a file swapped
 * after the precheck can come back with the same numbers. An open handle keeps the inode
 * allocated, so while it is open no other file can get its number, and the dev/ino checks
 * after link() and in the rollback hold. Close it when the pass (and any rollback) is done.
 */
export interface PinnedFile {
  id: FileIdentity;
  close: () => Promise<void>;
}

/** Open `p` (a regular file, not followed if a symlink) and hold it; or the refusal code. */
export async function pinFile(p: string): Promise<{ pinned: PinnedFile } | { code: string }> {
  // No symlink followed, and a FIFO swapped in never blocks the open (each flag is 0 where unknown)
  const flags = (fsConstants?.O_RDONLY ?? 0) | (fsConstants?.O_NOFOLLOW ?? 0) | (fsConstants?.O_NONBLOCK ?? 0);
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(p, flags);
  } catch (error) {
    return { code: (error as NodeJS.ErrnoException).code === 'ELOOP' ? 'SYMLINK' : refusalFromError(error).code };
  }
  const stat = await handle.stat({ bigint: true }).catch(() => null);
  if (!stat?.isFile()) {
    await handle.close().catch(() => undefined);
    return { code: stat ? 'NOT_REGULAR' : 'ERROR' };
  }
  return { pinned: { id: { dev: stat.dev, ino: stat.ino }, close: () => handle.close().catch(() => undefined) } };
}

export type LinkOutcome =
  | { kind: 'linked' }
  /** The target name appeared meanwhile: the caller applies its existing-target rules. */
  | { kind: 'exists' }
  /** Any error, or a failed check: the whole book then copies or stops. */
  | { kind: 'refused'; refusal: LinkRefusal };

async function identityOf(p: string): Promise<{ id: FileIdentity; file: boolean; nlink: bigint } | null> {
  try {
    const s = await fs.lstat(p, { bigint: true });
    return { id: { dev: s.dev, ino: s.ino }, file: s.isFile(), nlink: s.nlink };
  } catch {
    return null;
  }
}

/**
 * Hard-link `source` at `target` (which must not exist) and verify the result against
 * `expected`, the identity of the source pinned at the precheck (pinFile, still open): the new name is a regular
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
    return { kind: 'refused', refusal: LINK_UNSUPPORTED.has(code) ? linkRefusal(code) : refusalFromError(error) };
  }

  const placed = await identityOf(target);
  const still = await identityOf(source);
  const verified =
    !!placed && placed.file && sameIdentity(placed.id, expected) && placed.nlink >= BigInt(2) &&
    !!still && still.file && sameIdentity(still.id, expected);
  if (verified) return { kind: 'linked' };

  // A name that can't be removed stays; the book pass reports it (book-link.ts)
  await fs.unlink(target).catch(() => undefined);
  return { kind: 'refused', refusal: linkRefusal('VERIFY') };
}
