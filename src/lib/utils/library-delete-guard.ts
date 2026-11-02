/**
 * Component: Library Delete Guard (admin request deletes)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Decides whether deleting a request may remove the book's stored library
 * folder (`Audiobook.filePath`), or ebook files in it. A folder is removed only
 * when it provably holds this book's import and nothing else:
 *  a. strictly inside media_dir (never media_dir itself)
 *  b. equals or contains no configured root (download dirs, mapped paths, bookdrop)
 *  c. equals or contains no other book's stored folder (each row canonicalized;
 *     rows whose folder no longer exists are skipped)
 *  evidence: the audio files directly in the folder hash to the book's
 *     filesHash, and no subfolder holds audio (the removal is recursive)
 * A missing folder counts as already gone only when the library looks mounted
 * (media_dir readable and not empty, and some other stored folder exists).
 * Rules a-c apply to the canonical folder and, for a symlink, to the link's own
 * location too; only the link is then removed. Reuses the post-import delete
 * guard's canonicalization and its fail-closed root list.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '../db';
import { collectGuardRoots, type GuardRoots } from '../processors/organize-cleanup-guard';
import {
  canonicalize,
  canonicalizeLinkLocation,
  type CanonicalPath,
  isSameEntry,
  isStrictlyInside,
  UnsafeDeleteError,
} from './delete-guard';
import { generateFilesHash } from './files-hash';
import { isAudioFile, isEbookFile, walkFiles } from './import-inventory';

export interface LibraryBook {
  id: string;
  filePath: string | null;
  filesHash: string | null;
}

export interface SafeLibraryDelete {
  /** Path to remove: the canonical folder, or the link itself when filePath is a symlink. */
  deletePath: string;
  /** Canonical folder the checks ran on (the link target for a symlink). */
  canonicalPath: string;
  /** False when nothing exists at filePath (already gone): there is nothing to remove. */
  exists: boolean;
  roots: GuardRoots;
}

const ROW_BATCH = 50;

/**
 * Other books' stored folders, canonicalized; rows whose folder no longer exists are skipped.
 * `stored` counts every other row with a folder (missing or not).
 */
async function otherBookFolders(bookId: string): Promise<{ folders: Array<{ title: string; canonical: CanonicalPath }>; stored: number }> {
  const rows = await prisma.audiobook.findMany({
    where: { id: { not: bookId }, filePath: { not: null } },
    select: { id: true, title: true, filePath: true },
  });
  const folders: Array<{ title: string; canonical: CanonicalPath }> = [];
  for (let i = 0; i < rows.length; i += ROW_BATCH) {
    const batch = await Promise.all(
      rows.slice(i, i + ROW_BATCH).map(async (row) => {
        if (!row.filePath || !(await fs.lstat(row.filePath).catch(() => null))) return null;
        return { title: row.title, canonical: await canonicalize(row.filePath) };
      })
    );
    for (const folder of batch) if (folder) folders.push(folder);
  }
  return { folders, stored: rows.length };
}

/**
 * Why a missing stored folder may not mean "already gone": the media volume
 * looks unmounted (media_dir unreadable or empty, e.g. the container started
 * before an NFS/SMB mount), or no other book's stored folder exists either.
 * Null when the library looks mounted.
 */
async function unmountedLibraryReason(mediaDir: string, others: { folders: unknown[]; stored: number }): Promise<string | null> {
  const entries = await fs.readdir(mediaDir).catch(() => null);
  if (!entries || entries.length === 0) {
    return `the media library (${mediaDir}) is unreadable or empty; is the media volume mounted?`;
  }
  if (others.stored > 0 && others.folders.length === 0) {
    return `no stored book folder exists under the media library (${mediaDir}); is the media volume mounted?`;
  }
  return null;
}

/**
 * Why the folder is not provably this book's import, or null when it is:
 * the audio directly in it must hash to filesHash, and no subfolder may hold audio.
 */
export async function folderEvidenceBlocker(dir: string, filesHash: string | null): Promise<string | null> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    return `the folder could not be read (${(error as NodeJS.ErrnoException).code ?? 'error'})`;
  }
  const directAudio: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const walk = await walkFiles(path.join(dir, entry.name));
      if (!walk.complete) return 'a subfolder could not be read';
      if (walk.files.some(isAudioFile)) return 'it has audio files in a subfolder';
    } else if (isAudioFile(entry.name)) {
      directAudio.push(entry.name);
    }
  }
  if (!filesHash) return 'there is no import record (files hash) for this folder';
  if (generateFilesHash(directAudio) !== filesHash) return 'folder contents changed since import';
  return null;
}

/** Rules a-c on one location; throws UnsafeDeleteError with the reason. */
function checkLocation(
  candidate: string,
  c: CanonicalPath,
  media: CanonicalPath,
  roots: CanonicalPath[],
  others: Array<{ title: string; canonical: CanonicalPath }>,
  what: string
): void {
  const refuse = (reason: string) => new UnsafeDeleteError(candidate, what ? `${what} ${reason}` : reason);
  if (isSameEntry(c, media)) throw refuse('it is the media library root');
  if (!isStrictlyInside(c, media)) throw refuse(`it is outside the media library (${media.path})`);
  for (const root of roots) {
    if (isSameEntry(c, root)) throw refuse(`it is a configured root (${root.path})`);
    if (isStrictlyInside(root, c)) throw refuse(`it contains a configured root (${root.path})`);
  }
  for (const other of others) {
    if (isSameEntry(other.canonical, c)) throw refuse(`it is also the folder of "${other.title}"`);
    if (isStrictlyInside(other.canonical, c)) throw refuse(`it contains the folder of "${other.title}"`);
  }
}

/**
 * True when the stored folder no longer exists AND lies outside the current
 * media_dir: a stale record (e.g. the library moved), not something to delete
 * or protect. False when unsure (roots unreadable, path still there).
 */
export async function isStaleStoredFolder(filePath: string | null): Promise<boolean> {
  if (!filePath || !filePath.trim()) return false;
  const linkPath = filePath.replace(/[\\/]+$/, '') || filePath;
  const missing = await fs.lstat(linkPath).then(
    () => false,
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT' || error.code === 'ENOTDIR'
  );
  if (!missing) return false;
  try {
    const media = await canonicalize((await collectGuardRoots()).mediaDir);
    const c = await canonicalize(filePath);
    return !isSameEntry(c, media) && !isStrictlyInside(c, media);
  } catch {
    return false;
  }
}

/**
 * Throw UnsafeDeleteError unless `filePath` may be removed for `book`.
 * `evidence: false` runs rules a-c only (the ebook delete applies its own file rule).
 * A failure to read the configured roots also refuses (fail closed).
 */
export async function assertSafeLibraryDelete(
  filePath: string,
  book: LibraryBook,
  options: { evidence?: boolean } = {}
): Promise<SafeLibraryDelete> {
  if (!filePath || !filePath.trim()) throw new UnsafeDeleteError(filePath, 'there is no stored folder');

  let roots: GuardRoots;
  try {
    roots = await collectGuardRoots();
  } catch (error) {
    throw new UnsafeDeleteError(filePath, error instanceof Error ? error.message : String(error));
  }
  const media = await canonicalize(roots.mediaDir);
  const otherRoots = await Promise.all(
    [...roots.downloadRoots, ...(roots.otherRoots ?? [])].filter(Boolean).map(canonicalize)
  );
  const otherBooks = await otherBookFolders(book.id);
  const others = otherBooks.folders;

  const linkPath = filePath.replace(/[\\/]+$/, '') || filePath;
  const entry = await fs.lstat(linkPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw new UnsafeDeleteError(filePath, `it could not be checked (${error.code ?? 'error'})`);
  });

  const target = await canonicalize(filePath);
  checkLocation(filePath, target, media, otherRoots, others, '');
  if (!entry) {
    // Already gone only if the library looks mounted; otherwise nothing is touched
    const unmounted = await unmountedLibraryReason(roots.mediaDir, otherBooks);
    if (unmounted) throw new UnsafeDeleteError(filePath, `the folder is missing and ${unmounted}`);
    return { deletePath: target.path, canonicalPath: target.path, exists: false, roots };
  }

  let deletePath = target.path;
  if (entry.isSymbolicLink()) {
    const location = await canonicalizeLinkLocation(linkPath);
    checkLocation(filePath, location, media, otherRoots, others, 'the link:');
    deletePath = location.path;
  }
  if (!(await fs.stat(target.path).catch(() => null))?.isDirectory()) {
    throw new UnsafeDeleteError(filePath, 'it is not a folder');
  }

  if (options.evidence !== false) {
    const blocker = await folderEvidenceBlocker(target.path, book.filesHash);
    if (blocker) throw new UnsafeDeleteError(filePath, blocker);
  }
  return { deletePath, canonicalPath: target.path, exists: true, roots };
}

/**
 * Ebook files an ebook request delete may unlink from `filePath`: rules a-c on
 * the folder, then every ebook file directly in it when the folder passes the
 * audio evidence rule, or the only one when it holds exactly one. Otherwise
 * (a shared or user folder with several ebooks) UnsafeDeleteError.
 */
export async function planEbookDelete(filePath: string, book: LibraryBook): Promise<string[]> {
  const safe = await assertSafeLibraryDelete(filePath, book, { evidence: false });
  if (!safe.exists) return [];
  const entries = await fs.readdir(safe.canonicalPath, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    throw new UnsafeDeleteError(filePath, `the folder could not be read (${error.code ?? 'error'})`);
  });
  const ebooks = entries.filter((e) => e.isFile() && isEbookFile(e.name)).map((e) => path.join(safe.canonicalPath, e.name));
  if (ebooks.length <= 1) return ebooks;
  const blocker = await folderEvidenceBlocker(safe.canonicalPath, book.filesHash);
  if (blocker) {
    throw new UnsafeDeleteError(filePath, `it holds ${ebooks.length} ebook files and is not provably this book's folder (${blocker})`);
  }
  return ebooks;
}
