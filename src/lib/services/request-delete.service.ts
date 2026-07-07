/**
 * Component: Request Deletion Service
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Handles soft deletion of requests with intelligent torrent/file cleanup
 */

import { prisma } from '../db';
import * as fs from 'fs/promises';
import * as path from 'path';
import { RMABLogger } from '../utils/logger';
import { buildAudiobookPath } from '../utils/file-organizer';
import { CLIENT_PROTOCOL_MAP, DownloadClientType } from '../interfaces/download-client.interface';

const logger = RMABLogger.create('RequestDelete');

export interface DeleteRequestResult {
  success: boolean;
  message: string;
  filesDeleted: boolean;
  torrentsRemoved: number;
  torrentsKeptSeeding: number;
  torrentsKeptUnlimited: number;
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
 * 3. Delete media files (title folder only)
 * 4. Delete from backend library (Plex/ABS)
 * 5. Clear audiobook availability linkage
 * 6. Soft delete request (set deletedAt, deletedBy)
 *
 * Logic (ebook requests):
 * 1. Check if request exists and is not already deleted
 * 2. Delete ebook files only (leave audiobook files intact)
 * 3. Soft delete request (set deletedAt, deletedBy)
 * Note: No backend library deletion or audiobook linkage clearing for ebooks
 */
export async function deleteRequest(
  requestId: string,
  // RMAB user ID of the actor, recorded as `deletedBy`. Pass null when the actor has no linked RMAB
  // account (e.g. a Discord admin-role holder) so a non-user identifier is never stored as deletedBy.
  adminUserId: string | null
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
            fileFormat: true,
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

    // 3. Delete media files
    // For audiobooks: delete entire title folder
    // For ebooks: delete only ebook files (leave audiobook files intact)
    let filesDeleted = false;
    try {
      const { getConfigService } = await import('./config.service');
      const configService = getConfigService();
      const mediaDir = (await configService.get('media_dir')) || '/media/audiobooks';
      // Use ebook-specific template for ebook requests, with fallback to audiobook template
      const audiobookTemplate = (await configService.get('audiobook_path_template')) || '{author}/{title} {asin}';
      const template = isEbook
        ? (await configService.get('ebook_path_template')) || audiobookTemplate
        : audiobookTemplate;

      // Fetch year from audible cache if ASIN is available
      let year: number | undefined;
      if (request.audiobook.audibleAsin) {
        const audibleCache = await prisma.audibleCache.findUnique({
          where: { asin: request.audiobook.audibleAsin },
          select: { releaseDate: true },
        });
        if (audibleCache?.releaseDate) {
          year = new Date(audibleCache.releaseDate).getFullYear();
        }
      }

      // Build path using centralized function
      const titleFolderPath = buildAudiobookPath(
        mediaDir,
        template,
        {
          author: request.audiobook.author,
          title: request.audiobook.title,
          narrator: request.audiobook.narrator || undefined,
          asin: request.audiobook.audibleAsin || undefined,
          year,
        }
      );

      // Check if folder exists
      try {
        await fs.access(titleFolderPath);

        if (isEbook) {
          // For ebooks: only delete ebook files, leave audiobook files intact
          const ebookExtensions = ['.epub', '.pdf', '.mobi', '.azw', '.azw3', '.fb2', '.cbz', '.cbr'];
          const files = await fs.readdir(titleFolderPath);

          let deletedCount = 0;
          for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (ebookExtensions.includes(ext)) {
              const filePath = path.join(titleFolderPath, file);
              await fs.unlink(filePath);
              logger.info(`Deleted ebook file: ${file}`);
              deletedCount++;
            }
          }

          filesDeleted = deletedCount > 0;
          logger.info(`Deleted ${deletedCount} ebook file(s) from: ${titleFolderPath}`);
        } else {
          // For audiobooks: delete the entire title folder
          await fs.rm(titleFolderPath, { recursive: true, force: true });
          logger.info(`Deleted media directory: ${titleFolderPath}`);
          filesDeleted = true;
        }
      } catch (accessError) {
        // Folder doesn't exist - that's okay
        logger.info(`Media directory not found: ${titleFolderPath}`);
        filesDeleted = false;
      }
    } catch (error) {
      logger.error(
        `Error deleting media files for request ${requestId}`,
        { error: error instanceof Error ? error.message : String(error) }
      );
      // Continue with soft delete even if file deletion fails
    }

    // 4. Delete from plex_library table and clear audiobook availability
    // Skip for ebooks - audiobook files and library entry should remain intact
    // This ensures the book immediately shows as NOT available when searching
    if (!isEbook) {
      try {
        const { getConfigService } = await import('./config.service');
        const configService = getConfigService();
        const backendMode = await configService.getBackendMode();

        // Delete from library backend (ABS or Plex)
        if (backendMode === 'audiobookshelf' && request.audiobook.absItemId) {
          // Audiobookshelf: delete the library item from ABS
          try {
            const { deleteABSItem } = await import('../services/audiobookshelf/api');
            await deleteABSItem(request.audiobook.absItemId);
            logger.info(
              `Deleted Audiobookshelf library item ${request.audiobook.absItemId} for "${request.audiobook.title}"`
            );
          } catch (absError) {
            logger.error(
              `Error deleting Audiobookshelf library item ${request.audiobook.absItemId}`,
              { error: absError instanceof Error ? absError.message : String(absError) }
            );
            // Continue with deletion even if ABS deletion fails
          }
        } else if (backendMode === 'plex' && request.audiobook.plexGuid) {
          // Plex: delete the library item from Plex by ratingKey
          try {
            // Query plex_library table to get the ratingKey
            const plexLibraryRecord = await prisma.plexLibrary.findUnique({
              where: { plexGuid: request.audiobook.plexGuid },
              select: { plexRatingKey: true },
            });

            if (plexLibraryRecord && plexLibraryRecord.plexRatingKey) {
              const ratingKey = plexLibraryRecord.plexRatingKey;

              // Get Plex config
              const plexServerUrl = (await configService.get('plex_url')) || '';
              const plexToken = (await configService.get('plex_token')) || '';

              if (plexServerUrl && plexToken) {
                const { getPlexService } = await import('../integrations/plex.service');
                const plexService = getPlexService();
                await plexService.deleteItem(plexServerUrl, plexToken, ratingKey);
                logger.info(
                  `Deleted Plex library item ${ratingKey} (plexGuid: ${request.audiobook.plexGuid}) for "${request.audiobook.title}"`
                );
              } else {
                logger.warn('Plex server URL or token not configured, skipping Plex library deletion');
              }
            } else {
              logger.warn(
                `No plexRatingKey found in plex_library for plexGuid: ${request.audiobook.plexGuid}`
              );
            }
          } catch (plexError) {
            logger.error(
              `Error deleting Plex library item (plexGuid: ${request.audiobook.plexGuid})`,
              { error: plexError instanceof Error ? plexError.message : String(plexError) }
            );
            // Continue with deletion even if Plex deletion fails
          }
        }

        // Delete plex_library records to ensure book shows as NOT available
        // Uses ASIN-based matching (same as availability check) for consistency
        try {
          let deletedCount = 0;

          // Primary method: Delete by ASIN (matches availability check logic exactly)
          // This ensures the same record found during availability check gets deleted
          if (request.audiobook.audibleAsin) {
            const asinDeleteResult = await prisma.plexLibrary.deleteMany({
              where: {
                OR: [
                  { asin: request.audiobook.audibleAsin },
                  { plexGuid: { contains: request.audiobook.audibleAsin } },
                ],
              },
            });
            deletedCount = asinDeleteResult.count;

            if (deletedCount > 0) {
              logger.info(
                `Deleted ${deletedCount} plex_library record(s) by ASIN "${request.audiobook.audibleAsin}" for "${request.audiobook.title}"`
              );
            }
          }

          // Fallback: Delete by exact title/author match (for legacy records without ASIN)
          // Only used if ASIN deletion didn't find any records
          if (deletedCount === 0) {
            const matchingLibraryRecords = await prisma.plexLibrary.findMany({
              where: {
                title: {
                  equals: request.audiobook.title,
                  mode: 'insensitive',
                },
                author: {
                  equals: request.audiobook.author,
                  mode: 'insensitive',
                },
              },
            });

            if (matchingLibraryRecords.length > 0) {
              const deletePromises = matchingLibraryRecords.map((record) =>
                prisma.plexLibrary.delete({ where: { id: record.id } })
              );
              await Promise.all(deletePromises);
              deletedCount = matchingLibraryRecords.length;

              logger.info(
                `Deleted ${deletedCount} plex_library record(s) by title/author for "${request.audiobook.title}"`
              );
            } else {
              logger.info(
                `No plex_library records found for "${request.audiobook.title}" (ASIN: ${request.audiobook.audibleAsin || 'none'})`
              );
            }
          }
        } catch (libError) {
          logger.error(
            `Error deleting plex_library records`,
            { error: libError instanceof Error ? libError.message : String(libError) }
          );
          // Continue with deletion even if library cleanup fails
        }

        // Clear audiobook record linkage
        const updateData: any = {
          status: 'requested', // Reset to requested state
          updatedAt: new Date(),
        };

        // Clear library linkage based on backend mode
        if (backendMode === 'audiobookshelf') {
          updateData.absItemId = null;
        } else {
          updateData.plexGuid = null;
        }

        await prisma.audiobook.update({
          where: { id: request.audiobook.id },
          data: updateData,
        });

        logger.info(
          `Cleared availability status for audiobook ${request.audiobook.id}`
        );
      } catch (error) {
        logger.error(
          `Error clearing audiobook status`,
          { error: error instanceof Error ? error.message : String(error) }
        );
        // Continue with deletion even if this fails
      }
    } else {
      logger.info(`Skipping backend library deletion for ebook request ${requestId}`);
    }

    // 5. Delete child requests (ebook requests linked to this audiobook request)
    if (!isEbook) {
      try {
        const childRequests = await prisma.request.findMany({
          where: {
            parentRequestId: requestId,
            deletedAt: null,
          },
          select: {
            id: true,
            type: true,
          },
        });

        if (childRequests.length > 0) {
          logger.info(`Found ${childRequests.length} child request(s) to delete`);

          // Soft delete all child requests
          await prisma.request.updateMany({
            where: {
              parentRequestId: requestId,
              deletedAt: null,
            },
            data: {
              deletedAt: new Date(),
              deletedBy: adminUserId,
            },
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
      message: 'Request deleted successfully',
      filesDeleted,
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
