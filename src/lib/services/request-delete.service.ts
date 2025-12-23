/**
 * Component: Request Deletion Service
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Handles soft deletion of requests with intelligent torrent/file cleanup
 */

import { prisma } from '../db';
import * as fs from 'fs/promises';
import * as path from 'path';

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
 * Logic:
 * 1. Check if request exists and is not already deleted
 * 2. For each download:
 *    - If unlimited seeding (0): Log and keep seeding, no monitoring
 *    - If incomplete download: Delete torrent + files
 *    - If seeding requirement met: Delete torrent + files
 *    - If still seeding: Keep in qBittorrent for cleanup job
 * 3. Delete media files (title folder only)
 * 4. Soft delete request (set deletedAt, deletedBy)
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

    // 2. Handle downloads & seeding
    const downloadHistory = request.downloadHistory[0];

    if (downloadHistory && downloadHistory.downloadClientId && downloadHistory.indexerName) {
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

        // Get torrent from qBittorrent
        const { getQBittorrentService } = await import('../integrations/qbittorrent.service');
        const qbt = await getQBittorrentService();

        let torrent;
        try {
          torrent = await qbt.getTorrent(downloadHistory.downloadClientId);
        } catch (error) {
          // Torrent not found in qBittorrent (already removed)
          console.log(`[RequestDelete] Torrent ${downloadHistory.downloadClientId} not found in qBittorrent, skipping`);
        }

        if (torrent) {
          // Torrent exists in qBittorrent
          const isUnlimitedSeeding = !seedingConfig || seedingConfig.seedingTimeMinutes === 0;
          const isCompleted = downloadHistory.downloadStatus === 'completed';

          if (isUnlimitedSeeding) {
            // Unlimited seeding - keep in qBittorrent, stop monitoring
            console.log(
              `[RequestDelete] Keeping torrent ${torrent.name} for unlimited seeding (indexer: ${downloadHistory.indexerName})`
            );
            torrentsKeptUnlimited++;
          } else if (!isCompleted) {
            // Download not completed - delete immediately
            console.log(
              `[RequestDelete] Deleting incomplete download: ${torrent.name}`
            );
            await qbt.deleteTorrent(downloadHistory.downloadClientId, true);
            torrentsRemoved++;
          } else {
            // Check if seeding requirement is met
            const seedingTimeSeconds = seedingConfig.seedingTimeMinutes * 60;
            const actualSeedingTime = torrent.seeding_time || 0;
            const hasMetRequirement = actualSeedingTime >= seedingTimeSeconds;

            if (hasMetRequirement) {
              // Seeding requirement met - delete now
              console.log(
                `[RequestDelete] Deleting torrent ${torrent.name} (seeding complete: ${Math.floor(
                  actualSeedingTime / 60
                )}/${seedingConfig.seedingTimeMinutes} minutes)`
              );
              await qbt.deleteTorrent(downloadHistory.downloadClientId, true);
              torrentsRemoved++;
            } else {
              // Still needs seeding - keep for cleanup job
              const remainingMinutes = Math.ceil((seedingTimeSeconds - actualSeedingTime) / 60);
              console.log(
                `[RequestDelete] Keeping torrent ${torrent.name} for ${remainingMinutes} more minutes of seeding`
              );
              torrentsKeptSeeding++;
            }
          }
        }
      } catch (error) {
        console.error(
          `[RequestDelete] Error handling torrent for request ${requestId}:`,
          error instanceof Error ? error.message : 'Unknown error'
        );
        // Continue with deletion even if torrent handling fails
      }
    }

    // 3. Delete media files (title folder only)
    let filesDeleted = false;
    try {
      const { getConfigService } = await import('./config.service');
      const configService = getConfigService();
      const mediaDir = (await configService.get('media_dir')) || '/media/audiobooks';

      // Sanitize author and title for path
      const sanitizedAuthor = sanitizePath(request.audiobook.author);
      const sanitizedTitle = sanitizePath(request.audiobook.title);

      // Build path: [media_dir]/[author]/[title]/
      const titleFolderPath = path.join(mediaDir, sanitizedAuthor, sanitizedTitle);

      // Check if folder exists
      try {
        await fs.access(titleFolderPath);

        // Delete the title folder (not the author folder)
        await fs.rm(titleFolderPath, { recursive: true, force: true });

        console.log(`[RequestDelete] Deleted media directory: ${titleFolderPath}`);
        filesDeleted = true;
      } catch (accessError) {
        // Folder doesn't exist - that's okay
        console.log(
          `[RequestDelete] Media directory not found (already deleted?): ${titleFolderPath}`
        );
        filesDeleted = false;
      }
    } catch (error) {
      console.error(
        `[RequestDelete] Error deleting media files for request ${requestId}:`,
        error instanceof Error ? error.message : 'Unknown error'
      );
      // Continue with soft delete even if file deletion fails
    }

    // 4. Soft delete request
    await prisma.request.update({
      where: { id: requestId },
      data: {
        deletedAt: new Date(),
        deletedBy: adminUserId,
      },
    });

    console.log(
      `[RequestDelete] Request ${requestId} soft-deleted by admin ${adminUserId}`
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
    console.error(
      `[RequestDelete] Failed to delete request ${requestId}:`,
      error instanceof Error ? error.message : 'Unknown error'
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

/**
 * Sanitize a path component (removes invalid characters)
 */
function sanitizePath(input: string): string {
  return (
    input
      // Remove invalid path characters
      .replace(/[<>:"/\\|?*]/g, '')
      // Trim dots and spaces from start/end
      .replace(/^[.\s]+|[.\s]+$/g, '')
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      // Limit length
      .substring(0, 200)
      .trim()
  );
}
