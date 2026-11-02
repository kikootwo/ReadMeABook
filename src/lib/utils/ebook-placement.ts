/**
 * Component: Ebook Placement Record (which ebook files a request put in the library, #497)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * `Request.placedEbookFiles` lists the ebook files an ebook request's imports
 * placed: `[{ path, size, sha256, placedAt }]`. An entry is written only when
 * placeFile copied the file ('copied'); 'identical', 'present' and 'differs'
 * mean the library already had it, so the import adds nothing (the field is then
 * at least []). NULL means no record (never imported, or imported before this
 * field existed). A record whose request had already delivered before its first
 * recorded import starts with UNRECORDED_EARLIER_IMPORT. A request delete removes
 * only recorded files, and only while each is still the exact file RMAB placed
 * (size + sha256) and its folder passes library delete guard rules a-c.
 */

import { createHash } from 'crypto';
import { createReadStream, type BigIntStats } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '../db';
import type { RMABLogger } from './logger';
import { UnsafeDeleteError } from './delete-guard';
import { isEbookFile, type PlacementRecord } from './import-inventory';
import { assertSafeLibraryDelete, type LibraryBook } from './library-delete-guard';

export interface EbookPlacement {
  /** Absolute library path of the placed file (placeFile's target). */
  path: string;
  size: number;
  /** sha256 (hex) of the placed bytes. */
  sha256: string;
  /** ISO time of the import that placed it. */
  placedAt: string;
}

export interface PlacementRecordRead {
  entries: EbookPlacement[];
  /** Items that are not a well-formed entry: their file is never removed. */
  unreadable: number;
  /** An earlier import of this request delivered with no record (before the field, or a failed write). */
  unrecordedEarlier: boolean;
}

/** Marker for "this request delivered before its first recorded import": never a file to remove. */
export const UNRECORDED_EARLIER_IMPORT = { earlierImport: 'unrecorded' } as const;

const SHA256 = /^[0-9a-f]{64}$/;

function isUnrecordedMarker(value: unknown): boolean {
  return !!value && typeof value === 'object' && (value as { earlierImport?: unknown }).earlierImport === 'unrecorded';
}

function isPlacement(value: unknown): value is EbookPlacement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.path === 'string' &&
    path.isAbsolute(v.path) &&
    !v.path.includes('\0') &&
    isEbookFile(path.basename(v.path)) &&
    Number.isSafeInteger(v.size) &&
    (v.size as number) >= 0 &&
    typeof v.sha256 === 'string' &&
    SHA256.test(v.sha256)
  );
}

/** The record as stored; null when there is none (SQL NULL and JSON null alike). */
export function readPlacements(value: unknown): PlacementRecordRead | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return { entries: [], unreadable: 1, unrecordedEarlier: false };
  const markers = value.filter(isUnrecordedMarker).length;
  const entries = value.filter(isPlacement);
  return { entries, unreadable: value.length - entries.length - markers, unrecordedEarlier: markers > 0 };
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** The entry for a file RMAB just placed; throws unless it is a regular file. */
export async function placementEntry(file: string): Promise<EbookPlacement> {
  const stat = await fs.lstat(file);
  if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a regular file`);
  return { path: path.resolve(file), size: stat.size, sha256: await sha256File(file), placedAt: new Date().toISOString() };
}

/**
 * Append `entry` to the stored value (same path: newest wins); anything stored is kept.
 * No stored record but `unrecordedEarlier` (the request delivered before): the record
 * starts with UNRECORDED_EARLIER_IMPORT.
 */
export function mergePlacements(stored: unknown, entry: EbookPlacement | null, unrecordedEarlier = false): unknown[] {
  const none = stored === null || stored === undefined;
  const existing = Array.isArray(stored) ? stored : none ? (unrecordedEarlier ? [{ ...UNRECORDED_EARLIER_IMPORT }] : []) : [stored];
  if (!entry) return existing;
  const samePath = (item: unknown) => !!item && typeof item === 'object' && (item as { path?: unknown }).path === entry.path;
  return [...existing.filter((item) => !samePath(item)), entry];
}

/**
 * After a successful ebook organize: record the file it placed, if it copied one.
 * Never throws. On a failure the field is left as it was (logged): the file is
 * then never removed by a request delete, which is the safe side.
 */
export async function recordEbookPlacement(requestId: string, record: PlacementRecord | undefined, logger: RMABLogger): Promise<void> {
  try {
    const entry = record?.status === 'copied' ? await placementEntry(record.target) : null;
    const row = await prisma.request.findUnique({ where: { id: requestId }, select: { placedEbookFiles: true, completedAt: true } });
    // completedAt is written after this record, so a value here is an earlier delivery
    const unrecordedEarlier = (row?.placedEbookFiles === null || row?.placedEbookFiles === undefined) && !!row?.completedAt;
    await prisma.request.update({
      where: { id: requestId },
      data: { placedEbookFiles: mergePlacements(row?.placedEbookFiles, entry, unrecordedEarlier) as object[] },
    });
    logger.info(
      entry
        ? `Recorded the placed ebook file ${path.basename(entry.path)} for request ${requestId}`
        : `No ebook file placed by this import (${record?.status ?? 'no placement'}); nothing recorded for a later delete`
    );
  } catch (error) {
    logger.warn(
      `Could not record the placed ebook file for request ${requestId} (${error instanceof Error ? error.message : String(error)}); deleting this request will keep it`
    );
  }
}

/**
 * Entries recorded by every other active request, of any book. A file two
 * requests recorded stays until neither needs it. Only the ebook organize writes
 * records, so only ebook requests can hold one.
 */
export async function otherRecordedEntries(requestId: string): Promise<EbookPlacement[]> {
  return activeRecordedEntries({ id: { not: requestId } });
}

/** Entries recorded by every active ebook request (an audiobook delete labels and keeps these, #526). */
export async function activeRecordedEntries(where: { id?: { not: string } } = {}): Promise<EbookPlacement[]> {
  const rows = await prisma.request.findMany({
    where: { ...where, deletedAt: null, type: 'ebook' },
    select: { placedEbookFiles: true },
  });
  return (rows ?? []).flatMap((row) => readPlacements(row.placedEbookFiles)?.entries ?? []);
}

/**
 * Whether another request's entry is this very file: same sha256 and size, and its
 * path reaches the same file (dev/ino), however that path is spelled (symlinked
 * folder, another case on a case-insensitive mount). An error code when one could not be checked.
 */
async function recordedByAnother(file: BigIntStats, entry: EbookPlacement, others: EbookPlacement[]): Promise<boolean | string> {
  for (const other of others) {
    if (other.sha256 !== entry.sha256 || other.size !== entry.size) continue;
    try {
      const s = await fs.lstat(other.path, { bigint: true });
      if (s.isFile() && s.dev === file.dev && s.ino === file.ino) return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'error';
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return code;
    }
  }
  return false;
}

export type PlacedFileDecision =
  /** Unlink this path: still the file RMAB placed, in a folder rules a-c allow. */
  | { kind: 'remove'; file: string }
  /** Nothing there any more (or its folder is gone): nothing to do. */
  | { kind: 'gone' }
  | { kind: 'kept'; reason: string };

/** Whether one recorded file may be unlinked for `book`'s request delete. */
export async function planPlacedEbookDelete(
  entry: EbookPlacement,
  book: LibraryBook,
  others: EbookPlacement[]
): Promise<PlacedFileDecision> {
  const name = path.basename(entry.path);
  let safe;
  try {
    safe = await assertSafeLibraryDelete(path.dirname(entry.path), book, { evidence: false });
  } catch (error) {
    if (error instanceof UnsafeDeleteError) return { kind: 'kept', reason: error.reason };
    return { kind: 'kept', reason: error instanceof Error ? error.message : String(error) };
  }
  if (!safe.exists) return { kind: 'gone' };

  const file = path.join(safe.canonicalPath, name);
  let shared: boolean | string;
  try {
    const stat = await fs.lstat(file, { bigint: true });
    if (!stat.isFile()) return { kind: 'kept', reason: `${name} is no longer the file RMAB placed` };
    if (Number(stat.size) !== entry.size || (await sha256File(file)) !== entry.sha256) {
      return { kind: 'kept', reason: `${name} changed since RMAB placed it` };
    }
    shared = await recordedByAnother(stat, entry, others);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'error';
    if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'gone' };
    return { kind: 'kept', reason: `${name} could not be checked (${code})` };
  }
  if (shared === true) return { kind: 'kept', reason: `${name} is also the ebook of another request` };
  if (shared) return { kind: 'kept', reason: `${name} could not be compared with another request's record (${shared})` };
  return { kind: 'remove', file };
}
