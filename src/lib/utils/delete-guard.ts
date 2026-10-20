/**
 * Component: Delete Safety Guard
 * Documentation: documentation/phase3/file-organization.md
 *
 * Last line of defense before any post-organize cleanup removes files.
 * Refuses deletes that would touch the organized target, a configured root,
 * or the media library. Paths are compared after canonicalization (realpath)
 * and by inode identity, so symlinks, junctions and case-insensitive mounts
 * cannot slip a library path past a plain string check.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { isPathBelowBoundary, normalizePath } from './cleanup-helpers';
import { FileIdentity, sameIdentity } from './copy-file';

export interface DeleteGuardContext {
  /** Organize target (the folder the files were organized into). */
  targetPath?: string;
  /** Media library root. */
  mediaDir: string;
  /** Download roots: download_dir, per-client download_dir/customPath, per-client mapped localPath. */
  downloadRoots: string[];
  /** Other protected roots (e.g. /bookdrop). */
  otherRoots?: string[];
  /**
   * Allow deleting inside the media library outside any download root.
   * Only manual-import source cleanup sets this (moving a book out of another
   * library folder); the target and every root stay protected regardless.
   */
  allowMediaSources?: boolean;
}

export class UnsafeDeleteError extends Error {
  constructor(public readonly candidate: string, public readonly reason: string) {
    super(`Refusing to delete ${candidate}: ${reason}`);
    this.name = 'UnsafeDeleteError';
  }
}

/** Canonical form of a path plus filesystem identities of it and its ancestors. */
export interface CanonicalPath {
  path: string;
  id?: FileIdentity;
  /** Identities of existing strict ancestors, nearest first. */
  ancestors: FileIdentity[];
}

/** Normalized form used by the guard (drive roots become 'C:/'; see normalizePath). */
export function normalizeGuardPath(p: string): string {
  return normalizePath(p);
}

async function statIdentity(p: string): Promise<FileIdentity | undefined> {
  try {
    const s = await fs.stat(p, { bigint: true });
    return { dev: s.dev, ino: s.ino };
  } catch {
    return undefined;
  }
}

function joinGuardPath(dir: string, base: string): string {
  return dir.endsWith('/') ? dir + base : `${dir}/${base}`;
}

/**
 * Resolve symlinks/junctions for the longest existing prefix of the path and
 * re-append the missing tail. Returns forward-slash normalized form.
 */
async function realpathLenient(p: string): Promise<string> {
  const resolved = path.resolve(p);
  try {
    return normalizeGuardPath(await fs.realpath(resolved));
  } catch {
    const parent = path.dirname(resolved);
    if (parent === resolved) {
      return normalizeGuardPath(resolved);
    }
    return joinGuardPath(await realpathLenient(parent), path.basename(resolved));
  }
}

/** Canonical (realpath, normalized) form of a path; missing tails are kept as-is. */
export async function canonicalPath(p: string): Promise<string> {
  return realpathLenient(p);
}

async function ancestorIdentities(canonical: string): Promise<FileIdentity[]> {
  const ancestors: FileIdentity[] = [];
  let current = canonical;
  while (true) {
    const parent = normalizeGuardPath(path.dirname(current));
    if (parent === current) break;
    const parentId = await statIdentity(parent);
    if (parentId) ancestors.push(parentId);
    current = parent;
  }
  return ancestors;
}

/** Canonical path (symlinks resolved) with the identities of it and its ancestors. */
export async function canonicalize(p: string): Promise<CanonicalPath> {
  const canonical = await realpathLenient(p);
  return { path: canonical, id: await statIdentity(canonical), ancestors: await ancestorIdentities(canonical) };
}

/**
 * The link's own location: canonical parent plus the link name, with the
 * link entry's identity (lstat). Used so a symlink inside a protected folder
 * is judged by where it sits, not only by what it points to.
 */
async function canonicalizeLinkLocation(linkPath: string): Promise<CanonicalPath> {
  const resolved = path.resolve(linkPath);
  const location = joinGuardPath(await realpathLenient(path.dirname(resolved)), path.basename(resolved));
  let id: FileIdentity | undefined;
  try {
    const s = await fs.lstat(resolved, { bigint: true });
    id = { dev: s.dev, ino: s.ino };
  } catch {
    id = undefined;
  }
  return { path: location, id, ancestors: await ancestorIdentities(location) };
}

export function isSameEntry(a: CanonicalPath, b: CanonicalPath): boolean {
  if (a.path === b.path) return true;
  return !!a.id && !!b.id && sameIdentity(a.id, b.id);
}

/** True when child sits strictly inside parent (by path or by ancestor identity). */
export function isStrictlyInside(child: CanonicalPath, parent: CanonicalPath): boolean {
  if (isPathBelowBoundary(child.path, parent.path)) return true;
  const parentId = parent.id;
  return !!parentId && child.ancestors.some((ancestor) => sameIdentity(ancestor, parentId));
}

/**
 * Throw UnsafeDeleteError unless `candidate` is safe to remove.
 *
 * Rules (any match refuses):
 *  a. candidate equals, contains, or sits inside the organize target
 *  b. candidate equals or contains any configured root (media, download, other)
 *  c. candidate is inside the media dir, unless it is inside a download root
 *     that itself sits strictly inside the media dir (or allowMediaSources)
 *
 * Returns the path the caller must act on: the canonical path that was checked.
 * When the candidate is a symlink, the rules above are applied to the link's
 * target and the returned path is the link itself, so only the link is removed.
 */
export async function assertSafeToDelete(candidate: string, ctx: DeleteGuardContext): Promise<string> {
  if (!candidate || !candidate.trim()) {
    throw new UnsafeDeleteError(candidate, 'empty path');
  }

  const target = ctx.targetPath ? await canonicalize(ctx.targetPath) : undefined;
  const media = await canonicalize(ctx.mediaDir);
  const downloads = await Promise.all(ctx.downloadRoots.filter(Boolean).map(canonicalize));
  const others = await Promise.all((ctx.otherRoots || []).filter(Boolean).map(canonicalize));

  const checkRules = (c: CanonicalPath, what: string) => {
    const refuse = (reason: string) => new UnsafeDeleteError(candidate, what ? `${what} ${reason}` : reason);

    // Rule a: organize target
    if (target) {
      if (isSameEntry(c, target)) throw refuse('it is the organize target');
      if (isStrictlyInside(target, c)) throw refuse('it contains the organize target');
      if (isStrictlyInside(c, target)) throw refuse('it is inside the organize target');
    }

    // Rule b: configured roots
    for (const root of [media, ...downloads, ...others]) {
      if (isSameEntry(c, root)) throw refuse(`it is a configured root (${root.path})`);
      if (isStrictlyInside(root, c)) throw refuse(`it contains a configured root (${root.path})`);
    }

    // Rule c: media library
    if (isStrictlyInside(c, media) && !ctx.allowMediaSources) {
      const insideNestedDownloadRoot = downloads.some(
        (d) => isStrictlyInside(d, media) && isStrictlyInside(c, d)
      );
      if (!insideNestedDownloadRoot) {
        throw refuse('it is inside the media library');
      }
    }
  };

  const c = await canonicalize(candidate);
  checkRules(c, '');

  // Strip trailing separators first: lstat('link/') would follow the link
  const linkPath = candidate.replace(/[\\/]+$/, '') || candidate;
  let isLink = false;
  try {
    isLink = (await fs.lstat(linkPath)).isSymbolicLink();
  } catch {
    // Missing candidate: nothing to resolve
  }
  if (!isLink) {
    return c.path;
  }

  // A symlink is removed as a link, so where the link itself sits must pass the
  // same rules (a library entry that is a link to a seeding file stays put)
  const location = await canonicalizeLinkLocation(linkPath);
  checkRules(location, 'the link:');
  return location.path;
}
