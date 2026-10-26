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
import * as path from 'path';
import { AUDIO_EXTENSIONS } from '../constants/audio-formats';
import { canonicalize, isSameEntry, isStrictlyInside } from './delete-guard';
import { probeAudioFile } from './chapter-merger';
import type { RMABLogger } from './logger';
import {
  discBookFiles,
  isPermutation,
  orderDiscLayout,
  parseDiscFolderName,
  resolveDiscLayout,
  slashEntryProblem,
  type DiscLayout,
} from './disc-layout';

/** Concurrent ffprobe calls when reading track tags for the import order. */
const PROBE_CONCURRENCY = 4;

function isAudioName(name: string): boolean {
  return (AUDIO_EXTENSIONS as readonly string[]).includes(path.extname(name).toLowerCase());
}

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
 */
export async function resolveDiscBook(dir: string, roots: readonly string[]): Promise<DiscBook | null> {
  const entries = await readEntries(dir);
  if (!entries) return null;
  const keys: string[] = [];
  let discFolders = 0;
  for (const entry of entries) {
    if (entry.isFile() && isAudioName(entry.name)) {
      keys.push(entry.name);
    } else if (entry.isDirectory() && parseDiscFolderName(entry.name)) {
      const children = await readEntries(path.join(dir, entry.name));
      const audio = (children ?? []).filter((c) => c.isFile() && isAudioName(c.name));
      if (audio.length > 0) discFolders++;
      keys.push(...audio.map((c) => `${entry.name}/${c.name}`));
    }
  }
  if (discFolders < 2) return null;
  const layout = resolveDiscLayout(keys);
  if (!layout || layout.prefix !== '' || layout.otherFiles.length > 0) return null;
  if (await isConfiguredRoot(dir, roots)) return null;
  return { layout, files: discBookFiles(layout) };
}

/** Audio files directly inside `dir` (Dirent types, as the folder listing shows them). */
async function countDirectAudio(dir: string): Promise<number> {
  const entries = await readEntries(dir);
  return (entries ?? []).filter((e) => e.isFile() && isAudioName(e.name)).length;
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
    if (!isAudioName(fileName)) return bad(400, `Not an audio file: ${fileName}`);
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

/** Raised before anything is written when a multi-disc import's source is its own target folder. */
export class InPlaceDiscImportError extends Error {
  constructor() {
    super(
      "The selected folder is this book's library folder (or inside it), so its disc folders would be copied flat next to themselves; nothing was changed"
    );
    this.name = 'InPlaceDiscImportError';
  }
}

async function readTrackNumbers(baseDir: string, files: Array<{ key: string; file: string }>) {
  const tracks = new Map<string, number | undefined>();
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const { key, file } = files[next++];
      try {
        tracks.set(key, (await probeAudioFile(path.join(baseDir, file))).trackNumber);
      } catch {
        tracks.set(key, undefined);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, files.length) }, worker));
  return tracks;
}

export interface DiscImportOptions {
  targetPath: string;
  /** Manual and Bulk Import: stop when the source is the target folder or inside it. */
  stopInPlace?: boolean;
  logger?: RMABLogger;
}

/**
 * Import order for a multi-disc source (relative paths as the organizer walked
 * them), or null when the files are not a multi-disc layout: then the caller
 * keeps its order. Throws InPlaceDiscImportError (before probing) when asked to
 * stop an in-place import. A probe failure or an order that is not a
 * permutation of the input falls back to null, never an error.
 */
export async function orderDiscImport(
  sourceDir: string,
  audioFiles: string[],
  options: DiscImportOptions
): Promise<string[] | null> {
  const byKey = new Map(audioFiles.map((file) => [file.split(path.sep).join('/'), file]));
  const keys = [...byKey.keys()];
  const layout = byKey.size === audioFiles.length ? resolveDiscLayout(keys) : null;
  if (!layout) return null;

  if (options.stopInPlace) {
    const source = await canonicalize(sourceDir);
    const target = await canonicalize(options.targetPath);
    if (isSameEntry(source, target) || isStrictlyInside(source, target)) throw new InPlaceDiscImportError();
  }

  const discFiles = layout.discs.flatMap((d) => d.files).map((key) => ({ key, file: byKey.get(key)! }));
  const tracks = await readTrackNumbers(sourceDir, discFiles);
  const { order, notes } = orderDiscLayout(layout, (key) => tracks.get(key));
  if (!isPermutation(keys, order)) {
    await options.logger?.warn('Multi-disc order did not cover every file; keeping the folder order');
    return null;
  }
  for (const number of notes.tiedNumbers) {
    await options.logger?.warn(`Several disc folders are numbered ${number}; ordering them by name`);
  }
  await options.logger?.info(
    `Multi-disc layout: ${layout.discs.length} disc folders, ${order.length} files ordered disc by disc` +
      (notes.byTracks.length > 0 ? ` (track tags used in ${notes.byTracks.join(', ')})` : '')
  );
  return order.map((key) => byKey.get(key)!);
}
