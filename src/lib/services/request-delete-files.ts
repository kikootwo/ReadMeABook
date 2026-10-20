/**
 * Component: Request Delete: Library Files and Backend Items
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Removes what a deleted request put in the library, behind the library
 * delete guard: the audiobook's stored folder (audiobook requests) or ebook
 * files in it (ebook requests). Backend items (Audiobookshelf, Plex) are
 * deleted only after RMAB removed the folder itself, and only when the item's
 * files lived inside that folder; ABS is never asked to delete files.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { canonicalPath, UnsafeDeleteError } from '../utils/delete-guard';
import { assertSafeLibraryDelete, isStaleStoredFolder, planEbookDelete, type LibraryBook } from '../utils/library-delete-guard';
import { sweepEmptyParents } from '../processors/organize-cleanup-guard';
import { isPathBelowBoundary, normalizePath } from '../utils/cleanup-helpers';

const logger = RMABLogger.create('RequestDelete');

const NO_FOLDER_REASON = 'RMAB has no stored folder for this book, so its library files were not removed';

export interface DeleteBook extends LibraryBook {
  title: string;
  plexGuid: string | null;
  absItemId: string | null;
}

export type LibraryFilesOutcome =
  /** RMAB removed the folder ('removed') or found it already gone ('gone'); `folder` is canonical. */
  | { kind: 'removed' | 'gone'; folder: string; mediaDir: string }
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

/** D1: remove the audiobook's stored folder when the guard allows it. */
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

  try {
    await fs.rm(safe.deletePath, { recursive: true, force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'error';
    logger.error(`Could not remove ${safe.deletePath} (${code}); keeping the library entry`, {
      error: error instanceof Error ? error.message : String(error),
    });
    // fs.rm stops at the first error: files before it are already gone
    const why = code === 'EACCES' || code === 'EPERM' ? 'permission denied' : code;
    return { kind: 'kept', reason: `the folder was partly removed (${why}); remove the rest manually` };
  }
  logger.info(`Deleted media directory: ${safe.deletePath}`);
  await sweepEmptyParents(safe.deletePath, safe.roots, undefined, logger, 'RequestDeleteParents').catch((error) => {
    logger.warn(`Empty parent sweep failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  return { kind: 'removed', folder: safe.canonicalPath, mediaDir: safe.roots.mediaDir };
}

/** D2: unlink the ebook files the guard allows (never a sweep of a shared folder). */
export async function removeEbookFiles(book: DeleteBook): Promise<{ deleted: number; keptReason?: string }> {
  if (!book.filePath) {
    logger.warn(`Skipping ebook file deletion for "${book.title}": no stored file path`);
    return { deleted: 0 };
  }
  let files: string[];
  try {
    files = await planEbookDelete(book.filePath, book);
  } catch (error) {
    const reason = refusal(error);
    logger.warn(`Keeping ebook files in ${book.filePath} for "${book.title}": ${reason}`);
    return { deleted: 0, keptReason: reason };
  }
  let deleted = 0;
  for (const file of files) {
    try {
      await fs.unlink(file);
      logger.info(`Deleted ebook file: ${path.basename(file)}`);
      deleted++;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'error';
      const why = code === 'EACCES' || code === 'EPERM' ? 'permission denied' : code;
      return { deleted, keptReason: `${path.basename(file)} could not be removed (${why})` };
    }
  }
  logger.info(`Deleted ${deleted} ebook file(s) from: ${book.filePath}`);
  return { deleted };
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
  const relFolder = normalizePath(path.posix.relative(await canonicalPath(mediaDir), folder));
  const rel = normalizePath(item.relPath).replace(/^\/+/, '');
  return !!relFolder && !relFolder.startsWith('..') && (rel === relFolder || rel.startsWith(`${relFolder}/`));
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
