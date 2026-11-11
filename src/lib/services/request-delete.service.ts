/**
 * Component: Request Deletion Service
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Handles soft deletion of requests with intelligent torrent/file cleanup
 */

import { usesItemIdColumn } from '../constants/backend-mode';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import {
  deleteBackendItem,
  deleteLibraryRecords,
  describeKept,
  type LibraryFilesOutcome,
  removeAudiobookFolder,
  removeEbookFiles,
} from './request-delete-files';
import { cleanUpRequestDownload, emptyDownloadCleanupCounts } from './request-delete-download';
import { clearRemovedEbookFolder, findChildRequests, keepDeliveredChildren, type ChildRequests } from './request-delete-children';
import type { KeptFile } from '../utils/book-folder-delete';
import { BEING_IMPORTED_WHERE, deleteTouchesLibrary } from '../utils/delete-touches-library';

const logger = RMABLogger.create('RequestDelete');

export interface DeleteRequestOptions {
  /**
   * Bulk delete (#212): refuse, changing nothing (error 'InLibrary'), when the request's
   * book is in the library or being imported (deleteTouchesLibrary on this call's own load)
   */
  refuseInLibrary?: boolean;
}

export interface DeleteRequestResult {
  success: boolean;
  message: string;
  filesDeleted: boolean;
  torrentsRemoved: number;
  torrentsKeptSeeding: number;
  torrentsKeptUnlimited: number;
  /** Set when library files were kept (the guard refused, or the removal failed): why. */
  filesKeptReason?: string;
  /**
   * Set when an audiobook delete removed the audio but the book folder stays (#526):
   * what it still holds and why (first 20, `more` for the rest); `error` when the
   * emptied folder itself could not be removed (e.g. `could not be removed (EBUSY)`).
   */
  folderKept?: { folder: string; files: KeptFile[]; more: number; error?: string };
  /** Torrents left in the client because another request still keeps them (shared-torrent rule). */
  torrentsKeptShared: number;
  /** Torrents left in the client because RMAB did not add them (it never removes those). */
  torrentsKeptNotOwned: number;
  error?: string;
}

/**
 * Soft delete a request with intelligent cleanup of media files and torrents
 *
 * Logic (audiobook requests):
 * 1. Check if request exists and is not already deleted
 * 2. For each download:
 *    - Seeding rule (evaluateSeeding, same as the seeding cleanup job): every limit
 *      that is set (seeding time, ratio) must be met; 0 turns a limit off
 *    - A torrent RMAB did not add (taken over, or a legacy row whose client added time says
 *      so or can't tell) is left exactly as it is: never removed, never changed
 *    - If both limits are 0 (or no indexer config): keep seeding forever, no monitoring
 *    - If incomplete download, or every set limit met: delete torrent + files,
 *      unless another request still keeps the torrent (shared-torrent rule)
 *    - Otherwise: keep in the client for the cleanup job
 * 3. Remove what the import placed in the stored folder (its audio; cover and junk
 *    only when nothing else is left; the folder only when empty, #526), only when the
 *    library delete guard allows it; folderKept lists what stayed
 * 4. If RMAB removed it: delete the backend item (ABS without files, Plex only
 *    when its files were inside the folder), plex_library records, linkage and
 *    stored paths (a delivered ebook request that stays: its ebook's folder and
 *    format). If files were kept: none of that, and filesKeptReason says why
 * 5. Child ebook requests (linked, or parentless on the same book): undelivered ones
 *    are soft-deleted; delivered ones stay, unlinked (parentRequestId null)
 * 6. Soft delete request (set deletedAt, deletedBy)
 *
 * Logic (ebook requests):
 * 1. Check if request exists and is not already deleted
 * 2. Delete only the ebook files this request's imports recorded (Request.placedEbookFiles),
 *    each still unchanged and in a folder the guard allows (audiobook files never touched).
 *    No record: nothing removed (filesKeptReason says why for a delivered request).
 *    A folder left with nothing but junk goes; the book's stored path is cleared if it was that folder
 * 3. Soft delete request (set deletedAt, deletedBy)
 * Note: No backend library deletion or audiobook linkage clearing for ebooks
 *
 * With `refuseInLibrary` (bulk delete): right after step 1, a request whose book is in the
 * library or being imported (deleteTouchesLibrary) is refused with error 'InLibrary', nothing changed;
 * one that passes leaves the plex_library rows (deleteLibraryRecords) as they are
 */
export async function deleteRequest(
  requestId: string,
  adminUserId: string,
  options: DeleteRequestOptions = {}
): Promise<DeleteRequestResult> {
  try {
    // 1. Find request (only active, non-deleted)
    const request = await prisma.request.findFirst({
      where: {
        id: requestId,
        deletedAt: null,
      },
      include: {
        audiobook: {
          select: {
            id: true,
            title: true,
            author: true,
            narrator: true,
            audibleAsin: true,
            plexGuid: true,
            absItemId: true,
            filePath: true,
            fileFormat: true,
            filesHash: true,
          },
        },
        downloadHistory: {
          where: {
            selected: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    // Determine request type (default to audiobook for backward compatibility)
    const requestType = (request as any)?.type || 'audiobook';
    const isEbook = requestType === 'ebook';

    if (!request) {
      return {
        success: false,
        message: 'Request not found or already deleted',
        filesDeleted: false,
        torrentsRemoved: 0,
        torrentsKeptSeeding: 0,
        torrentsKeptUnlimited: 0,
        torrentsKeptShared: 0,
        torrentsKeptNotOwned: 0,
        error: 'NotFound',
      };
    }

    // Bulk delete: decided on this load, before any side effect
    if (options.refuseInLibrary) {
      const importing = await prisma.request.count({ where: { audiobookId: request.audiobookId, ...BEING_IMPORTED_WHERE } });
      const row = { type: requestType, status: request.status, completedAt: request.completedAt, placedEbookFiles: request.placedEbookFiles, audiobook: request.audiobook };
      if (deleteTouchesLibrary(row, importing > 0)) {
        logger.info(`Request ${requestId} not deleted (bulk delete): its book is in the library or being imported`);
        return {
          success: false,
          message: 'Not deleted: the book is in your library or being imported',
          filesDeleted: false,
          torrentsRemoved: 0,
          torrentsKeptSeeding: 0,
          torrentsKeptUnlimited: 0,
          torrentsKeptShared: 0,
          torrentsKeptNotOwned: 0,
          error: 'InLibrary',
        };
      }
    }

    // 2. Handle downloads & seeding (skip for ebooks - they use direct HTTP downloads)
    const downloadHistory = request.downloadHistory[0];
    const skipTorrentHandling = isEbook; // Ebooks use direct downloads, not torrents/NZBs
    const downloadCounts = !skipTorrentHandling && downloadHistory && downloadHistory.indexerName
      ? await cleanUpRequestDownload(requestId, downloadHistory)
      : emptyDownloadCleanupCounts();


    // 3. Library files, behind the library delete guard
    // Audiobooks: the stored folder, only when it provably holds this import
    // Ebooks: only the ebook files this request's imports placed (#497), never a folder sweep
    const book = request.audiobook;
    let filesDeleted = false;
    let filesKeptReason: string | undefined;
    let outcome: LibraryFilesOutcome | null = null;
    let children: ChildRequests = { delivered: [], undelivered: [], survivorFolder: null };
    if (isEbook) {
      const ebook = await removeEbookFiles(book, request);
      filesDeleted = ebook.deleted > 0;
      filesKeptReason = ebook.keptReason;
      await clearRemovedEbookFolder(book, ebook.removedFolders ?? []);
    } else {
      outcome = await removeAudiobookFolder(book);
      filesDeleted = outcome.kind === 'removed';
      if (outcome.kind === 'kept') filesKeptReason = outcome.reason;
      children = await findChildRequests(requestId, book.id);
    }
    const kept = outcome?.kind === 'removed' && outcome.kept?.length ? outcome.kept : null;
    const folderError = outcome?.kind === 'removed' ? outcome.folderError : undefined;
    const folderKept = (kept || folderError) && outcome && outcome.kind === 'removed'
      ? {
        folder: outcome.folder,
        files: (kept ?? []).slice(0, 20),
        more: Math.max(0, (kept?.length ?? 0) - 20),
        ...(folderError && { error: folderError }),
      }
      : undefined;
    // A delivered ebook request that stays: the book keeps its ebook's folder and format (as an ebook import leaves it)
    const survivor = children.survivorFolder;
    const storedPath = { filePath: survivor?.folder ?? null, filesHash: null, fileFormat: survivor?.format ?? null };

    // 4. Backend item, plex_library records and availability (audiobooks only).
    // When files were kept, the library stays exactly as it is: no backend
    // delete, no record cleanup, no status reset, linkage and paths kept.
    if (outcome?.kind === 'stale') {
      // Stale record (e.g. the library moved): nothing to remove or protect here.
      // Only the stored path is cleared; backend item, records and status stay.
      await prisma.audiobook.update({
        where: { id: book.id },
        data: { ...storedPath, updatedAt: new Date() },
      });
    } else if (outcome && outcome.kind !== 'kept') {
      try {
        const { getConfigService } = await import('./config.service');
        const configService = getConfigService();
        const backendMode = await configService.getBackendMode();

        if (outcome.kind === 'removed' || outcome.kind === 'gone') {
          await deleteBackendItem(book, outcome, backendMode, configService);
        }
        // Bulk delete leaves the library index alone: the book can be in the library by another route
        if (!options.refuseInLibrary) await deleteLibraryRecords(book);

        // Reset to requested, clear the library linkage and the (now removed) stored folder
        await prisma.audiobook.update({
          where: { id: book.id },
          data: {
            status: 'requested',
            updatedAt: new Date(),
            ...(usesItemIdColumn(backendMode) ? { absItemId: null } : { plexGuid: null }),
            ...storedPath,
          },
        });
        logger.info(`Cleared availability status for audiobook ${book.id}`);
      } catch (error) {
        logger.error(`Error clearing audiobook status`, {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with deletion even if this fails
      }
    } else if (isEbook) {
      logger.info(`Skipping backend library deletion for ebook request ${requestId}`);
    } else {
      logger.warn(`Files kept for request ${requestId}: ${filesKeptReason}; backend item and library records left as they are`);
    }

    // 5. Child ebook requests: undelivered ones go with this request; delivered ones stay, unlinked
    if (!isEbook) await keepDeliveredChildren(children, adminUserId);

    // 6. Soft delete request
    await prisma.request.update({
      where: { id: requestId },
      data: {
        deletedAt: new Date(),
        deletedBy: adminUserId,
      },
    });

    logger.info(
      `Request ${requestId} soft-deleted by admin ${adminUserId}`
    );

    return {
      success: true,
      message: filesKeptReason
        ? `Request deleted; files kept: ${filesKeptReason}`
        : outcome?.kind === 'stale'
          ? 'Request deleted; its stored folder no longer exists outside the current media library, nothing was removed'
          : kept
            ? `Request deleted; the book folder stays because it still holds: ${describeKept(kept)}`
            : folderError
              ? `Request deleted; the emptied book folder ${folderError}`
              : 'Request deleted successfully',
      filesDeleted,
      ...(filesKeptReason && { filesKeptReason }),
      ...(folderKept && { folderKept }),
      ...downloadCounts,
    };
  } catch (error) {
    logger.error(
      `Failed to delete request ${requestId}`,
      { error: error instanceof Error ? error.message : String(error) }
    );

    return {
      success: false,
      message: 'Failed to delete request',
      filesDeleted: false,
      torrentsRemoved: 0,
      torrentsKeptSeeding: 0,
      torrentsKeptUnlimited: 0,
      torrentsKeptShared: 0,
      torrentsKeptNotOwned: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
