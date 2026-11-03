/**
 * Component: Request Delete: Library Files and Backend Items
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Removes what a deleted request put in the library, behind the library
 * delete guard: the audio of the audiobook's stored folder, RMAB's cover and
 * junk only when nothing else is left, and the folder only when empty (audiobook
 * requests, #526, utils/book-folder-delete.ts); or the ebook files the request's
 * imports recorded (ebook requests, #497). Backend items (Audiobookshelf, Plex)
 * are deleted only after RMAB removed the audio itself, and only when the item's
 * files lived inside that folder; ABS is never asked to delete files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { canonicalPath, UnsafeDeleteError } from '../utils/delete-guard';
import { assertSafeLibraryDelete, isStaleStoredFolder, type LibraryBook } from '../utils/library-delete-guard';
import { activeRecordedEntries, otherRecordedEntries, planPlacedEbookDelete, readPlacements } from '../utils/ebook-placement';
import { removeBookFolderFiles, removeFolderIfOnlyJunk, type KeptFile } from '../utils/book-folder-delete';
import { collectGuardRoots, sweepEmptyParents } from '../processors/organize-cleanup-guard';
import { isPathBelowBoundary } from '../utils/cleanup-helpers';
import { libraryRelativePath, normalizeRelPath } from '../utils/library-item-path';

const logger = RMABLogger.create('RequestDelete');

const NO_FOLDER_REASON = 'RMAB has no stored folder for this book, so its library files were not removed';
const NO_RECORD_WHY = 'it was imported before RMAB kept one, or the record could not be saved';
const LEGACY_EBOOK_REASON = `RMAB has no record of the ebook files this request placed (${NO_RECORD_WHY}), so no ebook file was removed`;
const EARLIER_IMPORT_REASON = `an earlier import of this request has no record (${NO_RECORD_WHY}), so its ebook file was not removed`;
const EBOOK_ALREADY_THERE_REASON = 'RMAB has no record that this request placed the ebook (its import found it already in the library), so it was not removed';
const UNREADABLE_RECORD_REASON = 'the placement record could not be read';

export interface DeleteBook extends LibraryBook {
  title: string;
  plexGuid: string | null;
  absItemId: string | null;
}

export type LibraryFilesOutcome =
  /**
   * RMAB removed the book's audio ('removed') or found the folder already gone ('gone'); `folder` is canonical.
   * `kept`: the folder stays because it still holds these (files of another request, or with no record).
   * `folderError`: the emptied folder's own rmdir failed (not ENOTEMPTY), e.g. `could not be removed (EBUSY)`.
   */
  | { kind: 'removed' | 'gone'; folder: string; mediaDir: string; kept?: KeptFile[]; folderError?: string }
  /** No stored folder and no library linkage: nothing in the library belongs to this request. */
  | { kind: 'none' }
  /** The stored folder no longer exists and lies outside media_dir (e.g. the library moved): a stale record. */
  | { kind: 'stale'; folder: string }
  /** Nothing was removed; the library (files, backend item, linkage) stays as it is. */
  | { kind: 'kept'; reason: string };

function refusal(error: unknown): string {
  if (error instanceof UnsafeDeleteError) return error.reason;
  return error instanceof Error ? error.message : String(error);
}

/** D1: remove what the audiobook's import placed in its stored folder when the guard allows it. */
export async function removeAudiobookFolder(book: DeleteBook): Promise<LibraryFilesOutcome> {
  if (!book.filePath) {
    if (book.absItemId || book.plexGuid) {
      return { kind: 'kept', reason: NO_FOLDER_REASON };
    }
    return { kind: 'none' };
  }

  if (await isStaleStoredFolder(book.filePath)) {
    logger.warn(`Stored folder ${book.filePath} for "${book.title}" no longer exists and is outside the media library; treating it as a stale record`);
    return { kind: 'stale', folder: book.filePath };
  }

  let safe;
  try {
    safe = await assertSafeLibraryDelete(book.filePath, book);
  } catch (error) {
    const reason = refusal(error);
    logger.warn(`Keeping library folder ${book.filePath} for "${book.title}": ${reason}`);
    return { kind: 'kept', reason };
  }

  if (!safe.exists) {
    logger.info(`Media directory not found: ${book.filePath}`);
    return { kind: 'gone', folder: safe.canonicalPath, mediaDir: safe.roots.mediaDir };
  }

  if (safe.deletePath !== safe.canonicalPath) {
    // Symlinked title folder: only the link is removed, nothing inside its target
    try {
      await fs.rm(safe.deletePath, { recursive: true, force: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'error';
      logger.error(`Could not remove the link ${safe.deletePath} (${code}); keeping the library entry`);
      const why = code === 'EACCES' || code === 'EPERM' ? 'permission denied' : code;
      return { kind: 'kept', reason: `the folder was partly removed (${why}); remove the rest manually` };
    }
    logger.info(`Deleted the link to the media directory: ${safe.deletePath}`);
    await sweepParents(safe.deletePath, safe.roots);
    return { kind: 'removed', folder: safe.canonicalPath, mediaDir: safe.roots.mediaDir };
  }

  const result = await removeBookFolderFiles(safe.canonicalPath, book.filesHash, await activeRecordedEntries());
  if (result.kind === 'kept') {
    logger.warn(`Keeping library folder ${safe.canonicalPath} for "${book.title}": ${result.reason}`);
    return { kind: 'kept', reason: result.reason };
  }
  if (result.folderRemoved) {
    logger.info(`Deleted media directory: ${safe.canonicalPath} (${result.removed} file(s))`);
    await sweepParents(safe.canonicalPath, safe.roots);
    return { kind: 'removed', folder: safe.canonicalPath, mediaDir: safe.roots.mediaDir };
  }
  if (result.folderError) {
    logger.warn(`Removed ${result.removed} file(s) from ${safe.canonicalPath} for "${book.title}"; the emptied folder ${result.folderError}`);
  }
  if (result.kept.length > 0) {
    logger.info(
      `Removed ${result.removed} file(s) from ${safe.canonicalPath} for "${book.title}"; the folder stays: ${describeKept(result.kept, result.kept.length)}`
    );
  }
  return {
    kind: 'removed',
    folder: safe.canonicalPath,
    mediaDir: safe.roots.mediaDir,
    kept: result.kept,
    ...(result.folderError && { folderError: result.folderError }),
  };
}

/** `a (why), b (why)`, at most `limit` entries, then `and N more`. */
export function describeKept(kept: KeptFile[], limit = 20): string {
  const shown = kept.slice(0, limit).map((k) => `${k.name} (${k.why})`);
  const more = kept.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

async function sweepParents(deleted: string, roots: Parameters<typeof sweepEmptyParents>[1]): Promise<void> {
  await sweepEmptyParents(deleted, roots, undefined, logger, 'RequestDeleteParents').catch((error) => {
    logger.warn(`Empty parent sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/** The ebook request fields the D2 delete reads (scalars deleteRequest already loads). */
export interface EbookDeleteRequest {
  id: string;
  status: string;
  completedAt: Date | null;
  placedEbookFiles: unknown;
}

/**
 * D2 (#497): unlink only the ebook files this request's imports placed
 * (Request.placedEbookFiles), each only while it is still the exact file RMAB
 * placed and its folder passes rules a-c. No record removes nothing.
 */
export async function removeEbookFiles(
  book: DeleteBook,
  request: EbookDeleteRequest
): Promise<{ deleted: number; keptReason?: string; removedFolders?: string[] }> {
  const record = readPlacements(request.placedEbookFiles);
  if (!record) {
    const delivered = request.status === 'downloaded' || !!request.completedAt;
    logger.info(`No ebook placement record for request ${request.id} ("${book.title}"); no ebook file removed`);
    return delivered ? { deleted: 0, keptReason: LEGACY_EBOOK_REASON } : { deleted: 0 };
  }
  if (record.entries.length === 0 && record.unreadable === 0 && !record.unrecordedEarlier) {
    logger.info(`Request ${request.id} placed no ebook file ("${book.title}": the library already had it); none removed`);
    return { deleted: 0, keptReason: EBOOK_ALREADY_THERE_REASON };
  }

  const reasons: string[] = [];
  if (record.unrecordedEarlier) reasons.push(EARLIER_IMPORT_REASON);
  if (record.unreadable > 0) reasons.push(UNREADABLE_RECORD_REASON);
  const others = record.entries.length > 0 ? await otherRecordedEntries(request.id) : [];
  let deleted = 0;
  const emptied = new Map<string, string>(); // canonical folder -> the recorded folder spelling
  for (const entry of record.entries) {
    const decision = await planPlacedEbookDelete(entry, book, others);
    if (decision.kind === 'kept') {
      reasons.push(decision.reason);
    } else if (decision.kind === 'gone') {
      logger.info(`Recorded ebook file already gone: ${entry.path}`);
    } else {
      try {
        await fs.unlink(decision.file);
        logger.info(`Deleted ebook file: ${decision.file}`);
        deleted++;
        emptied.set(path.dirname(decision.file), path.dirname(entry.path));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? 'error';
        const why = code === 'EACCES' || code === 'EPERM' ? 'permission denied' : code;
        reasons.push(`${path.basename(decision.file)} could not be removed (${why})`);
      }
    }
  }
  const removedFolders = await removeEmptiedFolders(emptied);
  const folders = removedFolders.length > 0 ? { removedFolders } : {};
  if (reasons.length === 0) return { deleted, ...folders };
  // Several entries can share one reason (e.g. two files in a folder that fails rule c): each shows once
  const keptReason = [...new Set(reasons)].join('; ');
  logger.warn(`Keeping ebook file(s) of request ${request.id} ("${book.title}"): ${keptReason}`);
  return { deleted, keptReason, ...folders };
}

/**
 * D2's empty-folder step (#526): each folder this delete unlinked a file from goes
 * when nothing but the junk list is left, only when the recorded folder is itself
 * a real folder (not a link) at the canonical path rules a-c passed on; then empty
 * parents are swept. Returns the canonical folders removed. A failed rmdir is only
 * logged: the recorded files are gone, so it is not "files kept".
 */
async function removeEmptiedFolders(emptied: Map<string, string>): Promise<string[]> {
  const removed: string[] = [];
  for (const [checkedDir, recordedDir] of emptied) {
    const entry = await fs.lstat(recordedDir).catch(() => null);
    const folder = await canonicalPath(checkedDir).catch(() => null);
    if (!folder || !entry?.isDirectory() || (await canonicalPath(recordedDir).catch(() => null)) !== folder) continue;
    const result = await removeFolderIfOnlyJunk(folder);
    if (result.error) logger.warn(`The emptied ebook folder ${folder} ${result.error}; it stays`);
    if (!result.removed) continue;
    logger.info(`Deleted the emptied ebook folder: ${folder}`);
    removed.push(folder);
    try {
      await sweepParents(folder, await collectGuardRoots());
    } catch (error) {
      logger.warn(`Empty parent sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return removed;
}

/** True when `candidate` equals or sits inside the canonical `folder`. */
async function isInsideFolder(candidate: string, folder: string): Promise<boolean> {
  const c = await canonicalPath(candidate);
  return c === folder || isPathBelowBoundary(c, folder);
}

/**
 * ABS item paths are as ABS sees them: match the absolute path, or the path
 * relative to its library folder (ABS mounting the library elsewhere). The
 * relative match can also hit the same relative path in another ABS library
 * folder; the delete is hard=0, so at most that item's database entry goes.
 */
async function absItemInside(item: { path?: string; relPath?: string }, folder: string, mediaDir: string): Promise<boolean> {
  if (item.path && (await isInsideFolder(item.path, folder))) return true;
  if (!item.relPath) return false;
  const relFolder = await libraryRelativePath(folder, mediaDir);
  const rel = normalizeRelPath(item.relPath);
  return !!relFolder && (rel === relFolder || rel.startsWith(`${relFolder}/`));
}

type ConfigReader = { get(key: string): Promise<string | null> };

/**
 * Delete the book's backend item after RMAB removed (or found gone) `folder`.
 * Skipped, with a log line, when the item's files are not all inside it: the
 * next library scan drops an item whose files are gone.
 */
export async function deleteBackendItem(
  book: DeleteBook,
  outcome: { kind: 'removed' | 'gone'; folder: string; mediaDir: string },
  backendMode: string,
  configService: ConfigReader
): Promise<void> {
  if (backendMode === 'audiobookshelf' && book.absItemId) {
    try {
      const { getABSItem, deleteABSItem } = await import('./audiobookshelf/api');
      const item = await getABSItem(book.absItemId);
      if (!(await absItemInside(item ?? {}, outcome.folder, outcome.mediaDir))) {
        logger.warn(`Audiobookshelf item ${book.absItemId} (${item?.path ?? 'unknown path'}) is not inside ${outcome.folder}; leaving it`);
        return;
      }
      // RMAB already removed the folder: ABS removes only its database entry
      await deleteABSItem(book.absItemId, { hard: false });
      logger.info(`Deleted Audiobookshelf library item ${book.absItemId} for "${book.title}"`);
    } catch (error) {
      logger.error(`Error deleting Audiobookshelf library item ${book.absItemId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (backendMode === 'plex' && book.plexGuid) {
    if (outcome.kind === 'gone') {
      // RMAB did not remove anything, so there is no evidence the Plex item's files are gone:
      // leave it for the next library scan
      logger.info(`Folder ${outcome.folder} was already gone; leaving Plex item ${book.plexGuid} for the next library scan`);
      return;
    }
    try {
      const record = await prisma.plexLibrary.findUnique({
        where: { plexGuid: book.plexGuid },
        select: { plexRatingKey: true },
      });
      if (!record?.plexRatingKey) {
        logger.warn(`No plexRatingKey found in plex_library for plexGuid: ${book.plexGuid}`);
        return;
      }
      const plexServerUrl = (await configService.get('plex_url')) || '';
      const plexToken = (await configService.get('plex_token')) || '';
      if (!plexServerUrl || !plexToken) {
        logger.warn('Plex server URL or token not configured, skipping Plex library deletion');
        return;
      }
      const { getPlexService } = await import('../integrations/plex.service');
      const plexService = getPlexService();
      const files = await plexService.getItemFilePaths(plexServerUrl, plexToken, record.plexRatingKey);
      const inside = files.length > 0 && (await Promise.all(files.map((f) => isInsideFolder(f, outcome.folder)))).every(Boolean);
      if (!inside) {
        logger.warn(
          `Plex item ${record.plexRatingKey} has ${files.length ? 'files outside' : 'no files listed in'} ${outcome.folder}; leaving it for the next library scan`
        );
        return;
      }
      await plexService.deleteItem(plexServerUrl, plexToken, record.plexRatingKey);
      logger.info(`Deleted Plex library item ${record.plexRatingKey} (plexGuid: ${book.plexGuid}) for "${book.title}"`);
    } catch (error) {
      logger.error(`Error deleting Plex library item (plexGuid: ${book.plexGuid})`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Delete the book's plex_library records so it shows as not available
 * (ASIN match first, as the availability check does; then exact title/author).
 */
export async function deleteLibraryRecords(book: { title: string; author: string; audibleAsin: string | null }): Promise<void> {
  try {
    let deletedCount = 0;
    if (book.audibleAsin) {
      const result = await prisma.plexLibrary.deleteMany({
        where: { OR: [{ asin: book.audibleAsin }, { plexGuid: { contains: book.audibleAsin } }] },
      });
      deletedCount = result.count;
      if (deletedCount > 0) {
        logger.info(`Deleted ${deletedCount} plex_library record(s) by ASIN "${book.audibleAsin}" for "${book.title}"`);
      }
    }
    if (deletedCount === 0) {
      const records = await prisma.plexLibrary.findMany({
        where: {
          title: { equals: book.title, mode: 'insensitive' },
          author: { equals: book.author, mode: 'insensitive' },
        },
      });
      await Promise.all(records.map((record) => prisma.plexLibrary.delete({ where: { id: record.id } })));
      logger.info(
        records.length > 0
          ? `Deleted ${records.length} plex_library record(s) by title/author for "${book.title}"`
          : `No plex_library records found for "${book.title}" (ASIN: ${book.audibleAsin || 'none'})`
      );
    }
  } catch (error) {
    logger.error('Error deleting plex_library records', { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Why deleting this book's request would keep its library files (no side effects), or null. */
export async function audiobookFolderKeptReason(book: DeleteBook): Promise<string | null> {
  if (!book.filePath) {
    return book.absItemId || book.plexGuid ? NO_FOLDER_REASON : null;
  }
  if (await isStaleStoredFolder(book.filePath)) return null;
  try {
    await assertSafeLibraryDelete(book.filePath, book);
    return null;
  } catch (error) {
    return refusal(error);
  }
}
