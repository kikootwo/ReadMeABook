/**
 * Component: Import Inventory and Evidence (what was found, what verifiably reached the library)
 * Documentation: documentation/phase3/file-organization.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { AUDIO_EXTENSIONS } from '../constants/audio-formats';
import { normalizePath } from './cleanup-helpers';

/** Ebook formats the organizer imports, in preference order. */
export const ORGANIZER_EBOOK_FORMATS = ['epub', 'pdf', 'mobi', 'azw3', 'azw', 'fb2', 'cbz', 'cbr'];

export type InventoryKind = 'audio' | 'ebook';

export interface WalkResult {
  /** Relative paths of every file found. */
  files: string[];
  /** False when any directory could not be read: the file list may be short. */
  complete: boolean;
}

/** Recursively list files below `dir`, recording whether every directory was readable. */
export async function walkFiles(dir: string): Promise<WalkResult> {
  const files: string[] = [];
  let complete = true;

  async function walk(current: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      complete = false;
      return;
    }
    for (const entry of entries) {
      const rel = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), rel);
      } else {
        files.push(rel);
      }
    }
  }

  await walk(dir, '');
  return { files, complete };
}

export function isAudioFile(name: string): boolean {
  return (AUDIO_EXTENSIONS as readonly string[]).includes(path.extname(name).toLowerCase());
}

export function isEbookFile(name: string): boolean {
  return ORGANIZER_EBOOK_FORMATS.includes(path.extname(name).toLowerCase().slice(1));
}

/** Canonical key for a source path, used to match records against delete candidates. */
export function sourceKey(filePath: string): string {
  return normalizePath(path.resolve(filePath));
}

// =========================================================================
// PLACEMENT RECORDS AND EVIDENCE
// =========================================================================

/**
 * Outcome of placing one source into the library:
 * - copied:    written by this run (atomic copy, size-checked)
 * - identical: target already held the same bytes (or is the same regular file)
 * - present:   target already existed with the same size; not compared because no delete depended on it
 * - differs:   target holds different content, or is not a regular file; left untouched
 * - failed:    could not be placed
 */
export type PlacementStatus = 'copied' | 'identical' | 'present' | 'differs' | 'failed';

export interface PlacementRecord {
  /** Original source path (key), before tagging or merging. */
  source: string;
  /** Library path the content lives at. */
  target: string;
  status: PlacementStatus;
  /** True only when the source's content is proven to be in the library. */
  verified: boolean;
  reason?: string;
}

export interface ImportInventory {
  kind: InventoryKind;
  /** Absolute paths of every audio (or ebook) file found in the source. */
  files: string[];
  /** Absolute path of the source cover image, when one was found. */
  coverFile?: string;
  complete: boolean;
}

export interface ImportEvidence {
  records: PlacementRecord[];
  coverRecord?: PlacementRecord;
  inventory: ImportInventory;
  /** Placed files whose permissions could not be set (never affects what is verified). */
  permissionWarnings?: string[];
}

export function verifiedSourceKeys(evidence: ImportEvidence): Set<string> {
  return new Set(evidence.records.filter((r) => r.verified).map((r) => sourceKey(r.source)));
}

/**
 * Records for sources not proven to be in the library: failed, different
 * content, or placed but not verified (e.g. a merge whose duration was off).
 * Same-size files left uncompared ('present') are not counted: nothing is
 * deleted on their account.
 */
export function unverifiedRecords(evidence: ImportEvidence): PlacementRecord[] {
  return evidence.records.filter((r) => !r.verified && r.status !== 'present');
}

/** Every ebook file at `sourcePath` (a file or a folder), for the ebook branch's evidence. */
export async function ebookInventory(sourcePath: string): Promise<ImportInventory> {
  try {
    const stats = await fs.lstat(sourcePath);
    if (!stats.isDirectory()) {
      return { kind: 'ebook', files: isEbookFile(sourcePath) ? [sourcePath] : [], complete: true };
    }
  } catch {
    return { kind: 'ebook', files: [], complete: false };
  }
  const walk = await walkFiles(sourcePath);
  return {
    kind: 'ebook',
    files: walk.files.filter(isEbookFile).map((rel) => path.join(sourcePath, rel)),
    complete: walk.complete,
  };
}

/**
 * Whether a whole source folder (or file) may be removed: the inventory is
 * complete and every audio (or ebook) file in it was verified. Returns the
 * reason when not.
 */
export function folderRemovalBlocker(evidence: ImportEvidence): string | null {
  const { inventory } = evidence;
  if (!inventory.complete) {
    return 'the source folder could not be fully read';
  }
  if (inventory.files.length === 0) {
    return 'no imported files were found in the source';
  }
  const verified = verifiedSourceKeys(evidence);
  const unverified = inventory.files.filter((f) => !verified.has(sourceKey(f)));
  if (unverified.length > 0) {
    return `${unverified.length} of ${inventory.files.length} files not verified in the library`;
  }
  // Only audio (or the ebook) is verified: non-audio extras (cover, nfo, ...) go with the folder
  return null;
}

/**
 * Re-walk the source right before removing it. Refuses when the walk is
 * incomplete or finds audio/ebook files the import never saw, and (for
 * ebooks) when the folder holds more ebook files than were imported.
 */
export async function rewalkBlocker(sourcePath: string, evidence: ImportEvidence): Promise<string | null> {
  let stats;
  try {
    stats = await fs.lstat(sourcePath);
  } catch {
    return null;
  }
  if (!stats.isDirectory()) {
    return null;
  }
  const walk = await walkFiles(sourcePath);
  if (!walk.complete) {
    return 'the source folder could not be fully read';
  }
  const known = new Set(evidence.inventory.files.map(sourceKey));
  const matches = evidence.inventory.kind === 'ebook' ? isEbookFile : isAudioFile;
  const current = walk.files.filter(matches).map((rel) => sourceKey(path.join(sourcePath, rel)));
  const unseen = current.filter((key) => !known.has(key));
  if (unseen.length > 0) {
    return `${unseen.length} ${evidence.inventory.kind} file(s) appeared that were not imported`;
  }
  if (evidence.inventory.kind === 'ebook') {
    const imported = evidence.records.filter((r) => r.verified).length;
    if (current.length > imported) {
      return `the folder holds ${current.length} ebook files but ${imported} was imported`;
    }
  }
  return null;
}
