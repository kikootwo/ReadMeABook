/**
 * Component: Book Hard Link Pass (preconditions, link every file or none)
 * Documentation: documentation/features/library-placement.md
 *
 * Every file goes through placeFile({ link }) (organize-copy.ts), so the existing-target
 * rules are the copy's. A book-level refusal removes this run's links again: a book is
 * linked, copied or not imported, never half-linked by one run.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { collectGuardRoots } from '../processors/organize-cleanup-guard';
import { canonicalize, isStrictlyInside, type CanonicalPath } from './delete-guard';
import { sameIdentity, type FileIdentity } from './copy-file';
import { placeFile, withTargetLock, type PlaceResult } from './organize-copy';
import { linkRefusal, type LinkRefusal } from './link-file';
import type { RMABLogger } from './logger';

export interface BookLinkFile {
  source: string;
  target: string;
}

/** A file that is never linked or copied in link mode (a symlink, or outside the download folders). */
export interface RefusedSource {
  file: BookLinkFile;
  reason: string;
}

export interface BookLinkInput {
  files: BookLinkFile[];
  targetDir: string;
  fileMode: number;
  compareExisting: (target: string) => boolean;
  logger?: RMABLogger | null;
}

export type BookLinkResult =
  | { kind: 'placed'; placed: Array<{ file: BookLinkFile; result: PlaceResult }>; refused: RefusedSource[] }
  | { kind: 'cannot'; refusal: LinkRefusal; refused: RefusedSource[] };

export const SYMLINK_SOURCE = 'the download file is a symbolic link; not imported while File placement is a hard link';
export const NOT_REGULAR_SOURCE = 'the download file is not a regular file; not imported while File placement is a hard link';
export const OUTSIDE_SOURCE = 'the file is not in a download folder; not imported while File placement is a hard link';

// One link pass (and its rollback) per book folder at a time, so a second job for the same
// book never reports as in place a link this pass is about to remove
const bookLocks = new Map<string, Promise<void>>();

async function withBookLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(dir).toLowerCase();
  const previous = bookLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => mine);
  bookLocks.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (bookLocks.get(key) === tail) bookLocks.delete(key);
  }
}

type Precheck =
  | { eligible: Array<BookLinkFile & { id: FileIdentity }>; refused: RefusedSource[] }
  | { refusal: LinkRefusal; refused: RefusedSource[] };

async function precheck(files: BookLinkFile[], targetDir: string): Promise<Precheck> {
  const refused: RefusedSource[] = [];
  let media: CanonicalPath;
  let allowed: CanonicalPath[];
  try {
    const roots = await collectGuardRoots();
    media = await canonicalize(roots.mediaDir);
    allowed = await Promise.all([...roots.downloadRoots, ...(roots.otherRoots ?? [])].map(canonicalize));
  } catch {
    return { refusal: linkRefusal('ROOTS'), refused };
  }
  if (!isStrictlyInside(await canonicalize(targetDir), media)) return { refusal: linkRefusal('TARGET'), refused };
  const targetDev = (await fs.stat(targetDir, { bigint: true })).dev;

  const eligible: Array<BookLinkFile & { id: FileIdentity }> = [];
  for (const file of files) {
    let stat;
    try {
      stat = await fs.lstat(file.source, { bigint: true });
    } catch (error) {
      refused.push({ file, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (stat.isSymbolicLink()) { refused.push({ file, reason: SYMLINK_SOURCE }); continue; }
    if (!stat.isFile()) { refused.push({ file, reason: NOT_REGULAR_SOURCE }); continue; }
    const real = await canonicalize(file.source);
    if (!allowed.some((root) => isStrictlyInside(real, root))) { refused.push({ file, reason: OUTSIDE_SOURCE }); continue; }
    // Audiobookshelf would index both names of one inode
    if (isStrictlyInside(real, media)) return { refusal: linkRefusal('IN_LIBRARY'), refused };
    // Equal devices don't prove one mount (two bind mounts of a disk share st_dev); only link() can tell
    if (stat.dev !== targetDev) return { refusal: linkRefusal('EXDEV'), refused };
    eligible.push({ ...file, id: { dev: stat.dev, ino: stat.ino } });
  }
  return { eligible, refused };
}

/** Remove the names this pass linked that still are the download file; a replaced name stays. */
async function rollback(created: Array<{ target: string; id: FileIdentity }>, logger?: RMABLogger | null): Promise<void> {
  for (const { target, id } of [...created].reverse()) {
    await withTargetLock(target, async () => {
      const stat = await fs.lstat(target, { bigint: true }).catch(() => null);
      if (stat?.isFile() && sameIdentity({ dev: stat.dev, ino: stat.ino }, id)) {
        await fs.unlink(target).catch(async (error: unknown) => {
          await logger?.warn(`Could not remove the link ${path.basename(target)} again: ${error instanceof Error ? error.message : String(error)}`);
        });
      } else if (stat) {
        await logger?.warn(`Left alone: ${path.basename(target)} was replaced while the book was being linked`);
      }
    });
  }
}

/**
 * Link the book's files into `targetDir`. Book-level refusals (roots unreadable, folder
 * outside the media folder, download inside it, separate devices, a link error in
 * LINK_UNSUPPORTED, a failed verification, an interrupted copy in the way) remove the
 * links this pass made and return `cannot`. Per-file outcomes (in place, differs, other
 * errors) are returned as placeFile reports them. Refused sources are never linked.
 */
export async function linkBook(input: BookLinkInput): Promise<BookLinkResult> {
  return withBookLock(input.targetDir, async () => {
    const checked = await precheck(input.files, input.targetDir);
    if ('refusal' in checked) return { kind: 'cannot', refusal: checked.refusal, refused: checked.refused };

    const created: Array<{ target: string; id: FileIdentity }> = [];
    const placed: Array<{ file: BookLinkFile; result: PlaceResult }> = [];
    for (const file of checked.eligible) {
      const result = await placeFile(file.source, file.target, {
        fileMode: input.fileMode,
        compareExisting: input.compareExisting(file.target),
        link: file.id,
      });
      if (result.cannotLink) {
        await rollback(created, input.logger);
        return { kind: 'cannot', refusal: result.cannotLink, refused: checked.refused };
      }
      if (result.linked) created.push({ target: result.target, id: file.id });
      placed.push({ file: { source: file.source, target: file.target }, result });
    }
    return { kind: 'placed', placed, refused: checked.refused };
  });
}
