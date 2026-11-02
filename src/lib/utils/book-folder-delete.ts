/**
 * Component: Book Folder Delete (what an audiobook request delete removes from its folder, #526)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * D1, after the library delete guard passed on a real folder (not a symlink).
 * Removes, by name inside the folder only:
 *  - the audio directly in it, and only when that listing still hashes to the
 *    import's filesHash (the set the guard's evidence check hashed); otherwise nothing
 *  - RMAB's partial copies older than 24 h (PARTIAL_FILE_PATTERN, regular files)
 *  - `cover.jpg` (a regular file) and the junk list (book-folder-junk.ts), only when
 *    nothing else is left but those and ebooks recorded by active ebook requests
 * Subfolders are never entered (junk folders only through their limited walk).
 * The folder goes only when empty (non-recursive rmdir). Everything else stays and
 * is listed. `unlink` never follows a link in the last path component; a parent
 * swapped for a link mid-delete is followed (smaller exposure than a recursive rm).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { canonicalPath } from './delete-guard';
import { PARTIAL_FILE_PATTERN } from './copy-file';
import { generateFilesHash } from './files-hash';
import { isAudioFile, isEbookFile } from './import-inventory';
import { isJunkDirName, isJunkFileName, planJunkDir, removeJunkDir, type JunkDirPlan } from './book-folder-junk';

export interface KeptFile {
  /** Name inside the book folder; folders end with `/`. */
  name: string;
  why: string;
}

export const NO_RECORD_WHY = 'RMAB has no record that it placed it';
/** cover.jpg and junk that would have gone, kept only because something else stays beside them. */
export const KEPT_WITH_OTHERS_WHY = 'kept with the other files';
/** A label only: never a delete input. */
export const OTHER_REQUEST_EBOOK_WHY = 'ebook of another request';
const WRITING_WHY = 'an import is still writing it';
const STALE_PARTIAL_MS = 24 * 60 * 60 * 1000;

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code ?? 'error';
const readableWhy = (code: string) => (code === 'EACCES' || code === 'EPERM' ? 'permission denied' : code);
export const couldNotRemove = (code: string) => `could not be removed (${readableWhy(code)})`;

export interface BookFolderPlan {
  /** Audio names (the hashed set), unlinked first. */
  audio: string[];
  /** Stale partial copies: always removed. */
  partials: string[];
  /** cover.jpg and junk files/folders: removed only when `alone`. */
  coverAndJunk: { files: string[]; dirs: Array<{ name: string; plan: JunkDirPlan }> };
  /** True when nothing but cover, junk and recorded ebooks of active requests is left after the audio. */
  alone: boolean;
  kept: KeptFile[];
}

/**
 * Decide what D1 removes from `dir` (canonical). `recorded` are the entries of
 * active ebook requests (any book): a file of this folder that one of them names
 * stays, labelled, and does not keep the cover. A refusal means nothing is removed.
 */
export async function planBookFolderDelete(
  dir: string,
  filesHash: string | null,
  recorded: ReadonlyArray<{ path: string }>
): Promise<{ refused: string } | { plan: BookFolderPlan }> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    return { refused: `the folder could not be read (${errorCode(error)})` };
  }
  // Same selection as the guard's evidence check: direct non-folder entries with an audio name
  const audio = entries.filter((e) => !e.isDirectory() && isAudioFile(e.name)).map((e) => e.name);
  if (!filesHash || generateFilesHash(audio) !== filesHash) return { refused: 'folder contents changed since import' };

  const plan: BookFolderPlan = { audio, partials: [], coverAndJunk: { files: [], dirs: [] }, alone: true, kept: [] };
  const labels: KeptFile[] = [];
  const blocking: KeptFile[] = [];
  const now = Date.now();
  for (const entry of entries) {
    if (audio.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    let stat;
    try {
      stat = await fs.lstat(full);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue;
      blocking.push({ name: entry.name, why: `could not be checked (${errorCode(error)})` });
      continue;
    }
    const folderName = stat.isDirectory() ? `${entry.name}/` : entry.name;
    if (stat.isFile() && PARTIAL_FILE_PATTERN.test(entry.name)) {
      if (now - stat.mtimeMs > STALE_PARTIAL_MS) plan.partials.push(entry.name);
      else blocking.push({ name: entry.name, why: WRITING_WHY });
    } else if (stat.isFile() && (entry.name === 'cover.jpg' || isJunkFileName(entry.name))) {
      plan.coverAndJunk.files.push(entry.name);
    } else if (stat.isDirectory() && isJunkDirName(entry.name)) {
      const walked = await planJunkDir(full);
      if ('plan' in walked) plan.coverAndJunk.dirs.push({ name: entry.name, plan: walked.plan });
      else blocking.push({ name: folderName, why: `${NO_RECORD_WHY} (${walked.why})` });
    } else if (stat.isFile() && isEbookFile(entry.name) && (await isRecordedHere(dir, entry.name, recorded))) {
      labels.push({ name: entry.name, why: OTHER_REQUEST_EBOOK_WHY });
    } else {
      blocking.push({ name: folderName, why: NO_RECORD_WHY });
    }
  }
  plan.alone = blocking.length === 0;
  const coverAndJunkKept = plan.alone
    ? []
    : [...plan.coverAndJunk.files, ...plan.coverAndJunk.dirs.map((d) => `${d.name}/`)].map((name) => ({ name, why: KEPT_WITH_OTHERS_WHY }));
  plan.kept = [...labels, ...blocking, ...coverAndJunkKept].sort((a, b) => a.name.localeCompare(b.name));
  return { plan };
}

/** True when an active ebook request recorded `dir/name` (its folder canonicalized: same spelling rules as D2). */
async function isRecordedHere(dir: string, name: string, recorded: ReadonlyArray<{ path: string }>): Promise<boolean> {
  for (const entry of recorded) {
    if (path.basename(entry.path) !== name) continue;
    if ((await canonicalPath(path.dirname(entry.path)).catch(() => null)) === dir) return true;
  }
  return false;
}

export type BookFolderResult =
  /** Nothing removed, or the audio only partly: the library stays as it is. */
  | { kind: 'kept'; reason: string }
  /**
   * The audio is gone; `folderRemoved` false means the folder stays, holding `kept`.
   * `folderError`: the folder's own rmdir failed (not ENOTEMPTY), e.g. `could not be removed (EBUSY)`.
   */
  | { kind: 'removed'; folderRemoved: boolean; removed: number; kept: KeptFile[]; folderError?: string };

async function unlinkOne(file: string): Promise<string | null> {
  try {
    await fs.unlink(file);
    return null;
  } catch (error) {
    const code = errorCode(error);
    return code === 'ENOENT' ? null : code;
  }
}

/** D1: run the plan on `dir` (canonical), audio first; the folder goes only when empty. */
export async function removeBookFolderFiles(
  dir: string,
  filesHash: string | null,
  recorded: ReadonlyArray<{ path: string }>
): Promise<BookFolderResult> {
  const planned = await planBookFolderDelete(dir, filesHash, recorded);
  if ('refused' in planned) return { kind: 'kept', reason: planned.refused };
  const { plan } = planned;

  let removed = 0;
  for (const name of plan.audio) {
    const code = await unlinkOne(path.join(dir, name));
    if (code) {
      return {
        kind: 'kept',
        reason: removed > 0
          ? `the folder was partly removed (${readableWhy(code)}); remove the rest manually`
          : `${name} ${couldNotRemove(code)}`,
      };
    }
    removed++;
  }

  const kept = [...plan.kept];
  const files = [...plan.partials, ...(plan.alone ? plan.coverAndJunk.files : [])];
  for (const name of files) {
    const code = await unlinkOne(path.join(dir, name));
    if (code) kept.push({ name, why: couldNotRemove(code) });
    else removed++;
  }
  if (plan.alone) {
    for (const junk of plan.coverAndJunk.dirs) {
      const code = await removeJunkDir(junk.plan);
      if (code) kept.push({ name: `${junk.name}/`, why: couldNotRemove(code) });
    }
  }

  const folder = await removeIfEmpty(dir, kept);
  return { kind: 'removed', folderRemoved: folder.removed, removed, kept, ...(folder.error && { folderError: folder.error }) };
}

/**
 * rmdir `dir` when nothing is left; every rmdir error is ignored (a non-ENOTEMPTY
 * one is returned as `error`, never listed as content). Names found that are not in
 * `kept` yet (new since the plan) are added as unrecorded. `removed`: the folder is gone.
 */
async function removeIfEmpty(dir: string, kept: KeptFile[]): Promise<{ removed: boolean; error?: string }> {
  let left: string[];
  let error: string | undefined;
  try {
    left = await fs.readdir(dir);
  } catch (readError) {
    return { removed: errorCode(readError) === 'ENOENT' };
  }
  if (left.length === 0) {
    try {
      await fs.rmdir(dir);
      return { removed: true };
    } catch (rmdirError) {
      const code = errorCode(rmdirError);
      if (code === 'ENOENT') return { removed: true };
      if (code !== 'ENOTEMPTY' && code !== 'EEXIST') error = couldNotRemove(code);
      left = await fs.readdir(dir).catch(() => []);
    }
  }
  const listed = new Set(kept.map((k) => k.name.replace(/\/$/, '')));
  for (const name of left) if (!listed.has(name)) kept.push({ name, why: NO_RECORD_WHY });
  return { removed: false, ...(error && { error }) };
}

/**
 * D2's empty-folder step (#526): after an ebook delete unlinked a file of `dir`
 * (canonical, a real folder), remove the junk list when it is all that is left
 * (a written exception to "D2 removes only recorded files"), then the folder
 * when empty. Every rmdir error is ignored; a non-ENOTEMPTY one is returned.
 */
export async function removeFolderIfOnlyJunk(dir: string): Promise<{ removed: boolean; error?: string }> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    return { removed: errorCode(error) === 'ENOENT' };
  }
  const files: string[] = [];
  const dirs: JunkDirPlan[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const stat = await fs.lstat(full).catch(() => null);
    if (!stat) return { removed: false };
    if (stat.isFile() && isJunkFileName(entry.name)) {
      files.push(full);
    } else if (stat.isDirectory() && isJunkDirName(entry.name)) {
      const walked = await planJunkDir(full);
      if (!('plan' in walked)) return { removed: false };
      dirs.push(walked.plan);
    } else {
      return { removed: false };
    }
  }
  for (const file of files) if (await unlinkOne(file)) return { removed: false };
  for (const junk of dirs) if (await removeJunkDir(junk)) return { removed: false };
  try {
    await fs.rmdir(dir);
    return { removed: true };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') return { removed: true };
    return { removed: false, ...(code !== 'ENOTEMPTY' && code !== 'EEXIST' && { error: couldNotRemove(code) }) };
  }
}
