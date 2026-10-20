/**
 * Component: Replace: remove the old library content (no active request)
 * Documentation: documentation/admin-features/request-deletion.md
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { getConfigService } from './config.service';
import { deleteBackendItem, deleteLibraryRecords, removeAudiobookFolder } from './request-delete-files';

const logger = RMABLogger.create('ReportedIssue');

export interface ReplaceBook {
  id: string;
  title: string;
  author: string;
  audibleAsin: string | null;
  plexGuid: string | null;
  absItemId: string | null;
  filePath: string | null;
  filesHash: string | null;
}

/**
 * Remove a book's library content before a replace, when it has no active
 * request. Returns why the files were kept (nothing changed), or null.
 * - Stored folder (e.g. an earlier admin delete kept the files): removed only
 *   through the library delete guard, then the backend item (ABS hard=0, Plex
 *   only for items inside it) and the plex_library records. Never an ABS hard delete.
 * - No stored folder (book added to Plex/ABS outside RMAB): the backend removes
 *   it (ABS hard=1, Plex DELETE), as before.
 */
export async function removeLibraryContentForReplace(audiobook: ReplaceBook): Promise<string | null> {
  if (!audiobook.filePath) {
    return deleteFromLibrary(audiobook);
  }
  const outcome = await removeAudiobookFolder(audiobook);
  if (outcome.kind === 'kept') return outcome.reason;
  // Stale record (folder gone, outside the current media_dir): nothing to remove; the
  // replace resets the stored path
  if (outcome.kind === 'stale') return null;
  if (outcome.kind === 'removed' || outcome.kind === 'gone') {
    const configService = getConfigService();
    await deleteBackendItem(audiobook, outcome, await configService.getBackendMode(), configService);
  }
  await deleteLibraryRecords(audiobook);
  return null;
}

/**
 * Delete audiobook content from library backend directly (no RMAB request, no stored folder).
 * Used when a book was added to Plex/ABS outside of RMAB.
 */
async function deleteFromLibrary(audiobook: ReplaceBook): Promise<string | null> {
  const configService = getConfigService();
  const backendMode = await configService.getBackendMode();

  // Delete from library backend API
  if (backendMode === 'audiobookshelf') {
    // absItemId may be null if the book was added outside RMAB.
    // Fall back to looking up the ABS item ID from plex_library by ASIN
    // (plexGuid stores the ABS item ID when using ABS backend).
    let itemId = audiobook.absItemId;
    if (!itemId && audiobook.audibleAsin) {
      const libraryRecords = await prisma.plexLibrary.findMany({
        where: {
          OR: [
            { asin: audiobook.audibleAsin },
            { plexGuid: { contains: audiobook.audibleAsin } },
          ],
        },
        select: { plexGuid: true },
        take: 2,
      });
      if (libraryRecords.length > 1) {
        // Several library items share the ASIN: a hard delete could remove the wrong copy
        return `several library items match ASIN ${audiobook.audibleAsin}, so none was deleted`;
      }
      itemId = libraryRecords[0]?.plexGuid ?? null;
    }

    if (itemId) {
      try {
        const { deleteABSItem } = await import('./audiobookshelf/api');
        // No RMAB request and no stored folder: the book was added outside RMAB, so the
        // replacement removes the ABS content (files included)
        await deleteABSItem(itemId, { hard: true });
        logger.info(`Deleted ABS item ${itemId} for "${audiobook.title}"`);
      } catch (error) {
        logger.error(`Failed to delete ABS item ${itemId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      logger.warn(`No ABS item ID found for "${audiobook.title}" (ASIN: ${audiobook.audibleAsin}) — skipping ABS deletion`);
    }
  } else if (backendMode === 'plex' && audiobook.plexGuid) {
    try {
      const plexLibraryRecord = await prisma.plexLibrary.findUnique({
        where: { plexGuid: audiobook.plexGuid },
        select: { plexRatingKey: true },
      });

      if (plexLibraryRecord?.plexRatingKey) {
        const plexServerUrl = (await configService.get('plex_url')) || '';
        const plexToken = (await configService.get('plex_token')) || '';

        if (plexServerUrl && plexToken) {
          const { getPlexService } = await import('../integrations/plex.service');
          const plexService = getPlexService();
          await plexService.deleteItem(plexServerUrl, plexToken, plexLibraryRecord.plexRatingKey);
          logger.info(`Deleted Plex item ${plexLibraryRecord.plexRatingKey} for "${audiobook.title}"`);
        }
      }
    } catch (error) {
      logger.error(`Failed to delete Plex item for "${audiobook.title}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Delete plex_library records by ASIN
  if (audiobook.audibleAsin) {
    try {
      const result = await prisma.plexLibrary.deleteMany({
        where: {
          OR: [
            { asin: audiobook.audibleAsin },
            { plexGuid: { contains: audiobook.audibleAsin } },
          ],
        },
      });
      if (result.count > 0) {
        logger.info(`Deleted ${result.count} plex_library record(s) by ASIN "${audiobook.audibleAsin}"`);
      }
    } catch (error) {
      logger.error(`Failed to delete plex_library records for ASIN "${audiobook.audibleAsin}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return null;
}
