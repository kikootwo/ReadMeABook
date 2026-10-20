/**
 * Component: Request Deletion Service
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Handles soft deletion of requests with intelligent torrent/file cleanup
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { CLIENT_PROTOCOL_MAP, DownloadClientType } from '../interfaces/download-client.interface';
import {
  deleteBackendItem,
  deleteLibraryRecords,
  type LibraryFilesOutcome,
  removeAudiobookFolder,
  removeEbookFiles,
} from './request-delete-files';

const logger = RMABLogger.create('RequestDelete');

export interface DeleteRequestResult {
  success: boolean;
  message: string;
  filesDeleted: boolean;
  torrentsRemoved: number;
  torrentsKeptSeeding: number;
  torrentsKeptUnlimited: number;
  /** Set when library files were kept (the guard refused, or the removal failed): why. */
  filesKeptReason?: string;
  error?: string;
}

/**
 * Soft delete a request with intelligent cleanup of media files and torrents
 *
 * Logic (audiobook requests):
 * 1. Check if request exists and is not already deleted
 * 2. For each download:
 *    - If unlimited seeding (0): Log and keep seeding, no monitoring
 *    - If incomplete download: Delete torrent + files
 *    - If seeding requirement met: Delete torrent + files
 *    - If still seeding: Keep in qBittorrent for cleanup job
 * 3. Delete the stored title folder, only when the library delete guard allows it
 * 4. If RMAB removed it: delete the backend item (ABS without files, Plex only
 *    when its files were inside the folder), plex_library records, linkage and
 *    stored paths. If files were kept: none of that, and filesKeptReason says why
 * 5. Soft delete child ebook requests (linked, or parentless on the same book)
 * 6. Soft delete request (set deletedAt, deletedBy)
 *
 * Logic (ebook requests):
 * 1. Check if request exists and is not already deleted
 * 2. Delete ebook files only, when the guard allows it (leave audiobook files intact)
 * 3. Soft delete request (set deletedAt, deletedBy)
 * Note: No backend library deletion or audiobook linkage clearing for ebooks
 */
export async function deleteRequest(
  requestId: string,
  adminUserId: string
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
        error: 'NotFound',
      };
    }

    let torrentsRemoved = 0;
    let torrentsKeptSeeding = 0;
    let torrentsKeptUnlimited = 0;

    // 2. Handle downloads & seeding (skip for ebooks - they use direct HTTP downloads)
    const downloadHistory = request.downloadHistory[0];
    const skipTorrentHandling = isEbook; // Ebooks use direct downloads, not torrents/NZBs

    if (!skipTorrentHandling && downloadHistory && downloadHistory.indexerName) {
      try {
        // Get indexer seeding configuration
        const { getConfigService } = await import('./config.service');
        const configService = getConfigService();
        const indexersConfigStr = await configService.get('prowlarr_indexers');

        let seedingConfig: any = null;
        if (indexersConfigStr) {
          const indexersConfig = JSON.parse(indexersConfigStr);
          seedingConfig = indexersConfig.find(
            (idx: any) => idx.name === downloadHistory.indexerName
          );
        }

        // Handle download cleanup via unified interface
        const clientId = downloadHistory.downloadClientId || downloadHistory.torrentHash || downloadHistory.nzbId;
        const clientType = downloadHistory.downloadClient || 'qbittorrent';

        if (clientId && clientType !== 'direct') {
          const { getDownloadClientManager } = await import('./download-client-manager.service');
          const manager = getDownloadClientManager(configService);
          const protocol = CLIENT_PROTOCOL_MAP[clientType as DownloadClientType] || 'torrent';
          const client = await manager.getClientServiceForProtocol(protocol as 'torrent' | 'usenet');

          if (client) {
            // Get download info to check seeding status
            let downloadInfo;
            try {
              downloadInfo = await client.getDownload(clientId);
            } catch (error) {
              logger.info(`Download ${clientId} not found in ${clientType}, skipping`);
            }

            if (downloadInfo) {
              const isUnlimitedSeeding = !seedingConfig || seedingConfig.seedingTimeMinutes === 0;
              const isCompleted = downloadHistory.downloadStatus === 'completed';

              if (client.protocol === 'usenet') {
                // Usenet - no seeding concept, delete immediately
                try {
                  await client.deleteDownload(clientId, true);
                  logger.info(`Deleted download ${clientId} from ${client.clientType}`);
                  torrentsRemoved++;
                } catch (error) {
                  logger.info(`Download ${clientId} not found in ${client.clientType}, skipping`);
                }
              } else if (isUnlimitedSeeding) {
                // Unlimited seeding - keep in client, stop monitoring
                logger.info(
                  `Keeping download ${downloadInfo.name} for unlimited seeding (indexer: ${downloadHistory.indexerName})`
                );
                torrentsKeptUnlimited++;
              } else if (!isCompleted) {
                // Download not completed - delete immediately
                logger.info(`Deleting incomplete download: ${downloadInfo.name}`);
                await client.deleteDownload(clientId, true);
                torrentsRemoved++;
              } else {
                // Check if seeding requirement is met
                const seedingTimeSeconds = seedingConfig.seedingTimeMinutes * 60;
                const actualSeedingTime = downloadInfo.seedingTime || 0;
                const hasMetRequirement = actualSeedingTime >= seedingTimeSeconds;

                if (hasMetRequirement) {
                  logger.info(
                    `Deleting download ${downloadInfo.name} (seeding complete: ${Math.floor(
                      actualSeedingTime / 60
                    )}/${seedingConfig.seedingTimeMinutes} minutes)`
                  );
                  await client.deleteDownload(clientId, true);
                  torrentsRemoved++;
                } else {
                  const remainingMinutes = Math.ceil((seedingTimeSeconds - actualSeedingTime) / 60);
                  logger.info(
                    `Keeping download ${downloadInfo.name} for ${remainingMinutes} more minutes of seeding`
                  );
                  torrentsKeptSeeding++;
                }
              }
            }
          }
        }
      } catch (error) {
        logger.error(
          `Error handling download for request ${requestId}`,
          { error: error instanceof Error ? error.message : String(error) }
        );
        // Continue with deletion even if download handling fails
      }
    }


    // 3. Library files, behind the library delete guard
    // Audiobooks: the stored folder, only when it provably holds this import
    // Ebooks: ebook files in it (leave audiobook files intact), never a shared-folder sweep
    const book = request.audiobook;
    let filesDeleted = false;
    let filesKeptReason: string | undefined;
    let outcome: LibraryFilesOutcome | null = null;
    if (isEbook) {
      const ebook = await removeEbookFiles(book);
      filesDeleted = ebook.deleted > 0;
      filesKeptReason = ebook.keptReason;
    } else {
      outcome = await removeAudiobookFolder(book);
      filesDeleted = outcome.kind === 'removed';
      if (outcome.kind === 'kept') filesKeptReason = outcome.reason;
    }

    // 4. Backend item, plex_library records and availability (audiobooks only).
    // When files were kept, the library stays exactly as it is: no backend
    // delete, no record cleanup, no status reset, linkage and paths kept.
    if (outcome && outcome.kind !== 'kept') {
      try {
        const { getConfigService } = await import('./config.service');
        const configService = getConfigService();
        const backendMode = await configService.getBackendMode();

        if (outcome.kind !== 'none') {
          await deleteBackendItem(book, outcome, backendMode, configService);
        }
        await deleteLibraryRecords(book);

        // Reset to requested, clear the library linkage and the (now removed) stored folder
        await prisma.audiobook.update({
          where: { id: book.id },
          data: {
            status: 'requested',
            updatedAt: new Date(),
            ...(backendMode === 'audiobookshelf' ? { absItemId: null } : { plexGuid: null }),
            filePath: null,
            filesHash: null,
            fileFormat: null,
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

    // 5. Delete child requests: ebook requests linked to this audiobook request,
    // and ebook requests with no parent on the same book row
    if (!isEbook) {
      try {
        const childWhere = {
          deletedAt: null,
          OR: [
            { parentRequestId: requestId },
            { type: 'ebook', parentRequestId: null, audiobookId: book.id },
          ],
        };
        const childRequests = await prisma.request.findMany({
          where: childWhere,
          select: { id: true, type: true },
        });

        if (childRequests.length > 0) {
          logger.info(`Found ${childRequests.length} child request(s) to delete`);
          await prisma.request.updateMany({
            where: { id: { in: childRequests.map((c) => c.id) } },
            data: { deletedAt: new Date(), deletedBy: adminUserId },
          });
          logger.info(`Soft-deleted ${childRequests.length} child request(s)`);
        }
      } catch (error) {
        logger.error(
          `Error deleting child requests for ${requestId}`,
          { error: error instanceof Error ? error.message : String(error) }
        );
        // Continue with parent deletion even if child deletion fails
      }
    }


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
      message: filesKeptReason ? `Request deleted; files kept: ${filesKeptReason}` : 'Request deleted successfully',
      filesDeleted,
      ...(filesKeptReason && { filesKeptReason }),
      torrentsRemoved,
      torrentsKeptSeeding,
      torrentsKeptUnlimited,
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
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
