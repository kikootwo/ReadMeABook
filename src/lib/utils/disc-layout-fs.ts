/**
 * Component: Multi-Disc Folder Rule (filesystem side)
 * Documentation: documentation/features/multi-disc-folders.md
 *
 * Lists a book folder's disc folders (one level, Dirent types only, links never
 * followed), validates Manual Import selections against that listing, orders a
 * multi-disc import, and stops an import that would flatten a library folder
 * onto itself.
 */

import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import { asyncPool } from './async-pool';
import { isAudioFile } from './import-inventory';
import { canonicalize, isSameEntry, isStrictlyInside } from './delete-guard';
import { probeAudioFile } from './chapter-merger';
import type { RMABLogger } from './logger';
import {
  discBookFiles,
  discTrackTags,
  isPermutation,
  orderDiscLayout,
  parseDiscFolderName,
  resolveDiscLayout,
  slashEntryProblem,
  type DiscLayout,
  type DiscTrackTags,
} from './disc-layout';

/** Concurrent ffprobe calls when reading track tags for the import order. */
const PROBE_CONCURRENCY = 4;

async function readEntries(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/** True when `dir` is one of the configured roots (compared canonically: links, case, inode). */
export async function isConfiguredRoot(dir: string, roots: readonly string[]): Promise<boolean> {
  const candidate = await canonicalize(dir);
  for (const root of roots) {
    if (isSameEntry(candidate, await canonicalize(root))) return true;
  }
  return false;
}

export interface DiscBook {
  layout: DiscLayout;
  /** Keys in import order: the folder's own audio, then each disc folder's audio. */
  files: string[];
}

/**
 * The multi-disc book at `dir`: its own audio plus the audio directly inside
 * each disc-named child folder. Null unless two or more disc folders hold
 * audio, or when `dir` is a configured root. Uses Dirent types only, so
 * symlinked folders and files are never listed. Paths use the raw entry names.
 * `entries`: the caller's own listing of `dir`, when it already has one.
 */
export async function resolveDiscBook(
  dir: string,
  roots: readonly string[],
  entries: Dirent[] | null = null
): Promise<DiscBook | null> {
  entries ??= await readEntries(dir);
  if (!entries) return null;
  const keys: string[] = [];
  let discFolders = 0;
  for (const entry of entries) {
    if (entry.isFile() && isAudioFile(entry.name)) {
      keys.push(entry.name);
    } else if (entry.isDirectory() && parseDiscFolderName(entry.name)) {
      const children = await readEntries(path.join(dir, entry.name));
      const audio = (children ?? []).filter((c) => c.isFile() && isAudioFile(c.name));
      if (audio.length > 0) discFolders++;
      keys.push(...audio.map((c) => `${entry.name}/${c.name}`));
    }
  }
  // Keys are root files and `disc/file` only, so a layout has no wrapper prefix and no other files
  const layout = discFolders < 2 ? null : resolveDiscLayout(keys);
  if (!layout || (await isConfiguredRoot(dir, roots))) return null;
  return { layout, files: discBookFiles(layout) };
}

/** Audio files directly inside `dir` (Dirent types, as the folder listing shows them). */
async function countDirectAudio(dir: string): Promise<number> {
  const entries = await readEntries(dir);
  return (entries ?? []).filter((e) => e.isFile() && isAudioFile(e.name)).length;
}

export type ManualSelection =
  | { ok: true; files: string[]; audioFileCount: number }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Validate a Manual Import request's files for `folder`:
 * - entries without '/' are single files in the folder (stat-checked);
 * - entries with '/' must be in the folder's multi-disc book set;
 * - no entries: the folder's own audio (the organizer walks it), else the
 *   multi-disc book set, filled in so the import and any source removal stay
 *   scoped to the book.
 */
export async function resolveManualSelection(
  folder: string,
  selectedFiles: string[] | undefined,
  roots: readonly string[]
): Promise<ManualSelection> {
  const bad = (status: 400 | 404, error: string): ManualSelection => ({ ok: false, status, error });
  if (!selectedFiles || selectedFiles.length === 0) {
    const count = await countDirectAudio(folder);
    if (count > 0) return { ok: true, files: [], audioFileCount: count };
    const book = await resolveDiscBook(folder, roots);
    if (!book) return bad(400, 'No audio files found in the selected directory');
    return { ok: true, files: book.files, audioFileCount: book.files.length };
  }

  let bookSet: Set<string> | null = null;
  const files: string[] = [];
  for (const fileName of selectedFiles) {
    if (fileName.includes('/')) {
      bookSet ??= new Set((await resolveDiscBook(folder, roots))?.files ?? []);
      if (slashEntryProblem(fileName, bookSet)) return bad(400, `Invalid file name: ${fileName}`);
      files.push(fileName);
      continue;
    }
    // Prevent path traversal
    if (fileName.includes('\\') || fileName === '..' || fileName === '.') {
      return bad(400, `Invalid file name: ${fileName}`);
    }
    if (!isAudioFile(fileName)) return bad(400, `Not an audio file: ${fileName}`);
    try {
      const fileStat = await fs.stat(path.join(folder, fileName));
      if (!fileStat.isFile()) return bad(400, `Not a file: ${fileName}`);
      files.push(fileName);
    } catch {
      return bad(404, `File not found: ${fileName}`);
    }
  }
  return { ok: true, files, audioFileCount: files.length };
}

/** Raised before anything is written when a multi-disc or nested import's source is its own target folder. */
export class InPlaceDiscImportError extends Error {
  constructor() {
    super(
      "The selected folder is this book's library folder (or inside it), so the files in its subfolders would be copied flat into the same folder; nothing was changed"
    );
    this.name = 'InPlaceDiscImportError';
  }
}

async function readTrackNumbers(baseDir: string, files: Array<{ key: string; file: string }>) {
  // A probe that fails in any way (throws, rejects, returns nothing) is no tag
  const tracks = await asyncPool(files, PROBE_CONCURRENCY, async ({ file }) => {
    try {
      return (await probeAudioFile(path.join(baseDir, file)))?.trackNumber;
    } catch {
      return undefined;
    }
  });
  return new Map(files.map(({ key }, i) => [key, tracks[i]]));
}

export interface DiscImportOptions {
  targetPath: string;
  /** Manual and Bulk Import: stop when the source is the target folder or inside it. */
  stopInPlace?: boolean;
  /** The request's file selection: an entry with a '/' names a subfolder's file, so the stop applies. */
  selectedFiles?: string[];
  logger?: RMABLogger;
}

export interface DiscImport {
  /** The audio files (as walked) in import order. */
  order: string[];
  /** Disc and track tag values per file (as walked). */
  tags: Map<string, DiscTrackTags>;
}

/**
 * Import order and disc/track tag values for a multi-disc source (relative
 * paths as the organizer walked them), or null when the files are not a
 * multi-disc layout: then the caller keeps its order. When asked to stop an
 * in-place import, throws InPlaceDiscImportError before probing, for a
 * multi-disc layout and for any selection that names a subfolder's file
 * (one disc of a book included). Every file is probed for its track tag (root
 * files too). A failed probe counts as no tag; an order that is not a
 * permutation of the input falls back to null, never an error.
 */
export async function orderDiscImport(
  sourceDir: string,
  audioFiles: string[],
  options: DiscImportOptions
): Promise<DiscImport | null> {
  const byKey = new Map(audioFiles.map((file) => [file.split(path.sep).join('/'), file]));
  const keys = [...byKey.keys()];
  const layout = byKey.size === audioFiles.length ? resolveDiscLayout(keys) : null;

  if (options.stopInPlace && (layout || options.selectedFiles?.some((f) => f.includes('/')))) {
    const source = await canonicalize(sourceDir);
    const target = await canonicalize(options.targetPath);
    if (isSameEntry(source, target) || isStrictlyInside(source, target)) throw new InPlaceDiscImportError();
  }
  if (!layout) return null;

  const tracks = await readTrackNumbers(sourceDir, keys.map((key) => ({ key, file: byKey.get(key)! })));
  const { order, notes } = orderDiscLayout(layout, (key) => tracks.get(key));
  if (!isPermutation(keys, order)) {
    await options.logger?.warn('Multi-disc order did not cover every file; keeping the folder order');
    return null;
  }
  for (const number of notes.tiedNumbers) {
    await options.logger?.warn(`Several disc folders are numbered ${number}; ordering them by name`);
  }
  await options.logger?.info(
    `Multi-disc layout: ${layout.discs.length} disc folders, ${order.length} files ` +
      (notes.wholeBook
        ? 'ordered by their track tags across the whole book'
        : 'ordered disc by disc' + (notes.byTracks.length > 0 ? ` (track tags used in ${notes.byTracks.join(', ')})` : ''))
  );
  const tags = discTrackTags(layout, order);
  return {
    order: order.map((key) => byKey.get(key)!),
    tags: new Map(order.map((key) => [byKey.get(key)!, tags.get(key)!])),
  };
}
