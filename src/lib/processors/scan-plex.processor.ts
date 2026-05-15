/**
 * Component: Library Scan Job Processor
 * Documentation: documentation/backend/services/jobs.md
 *
 * Scans library (Plex or Audiobookshelf) and populates plex_library table with all audiobooks.
 * Works with both Plex and Audiobookshelf backends via abstraction layer.
 */

import { ScanPlexPayload } from '../services/job-queue.service';
import { prisma } from '../db';
import { getLibraryService } from '../services/library';
import { getConfigService } from '../services/config.service';
import { getThumbnailCacheService } from '../services/thumbnail-cache.service';
import { RMABLogger } from '../utils/logger';

/**
 * Process library scan job
 * Scans library and updates plex_library table (works for both Plex and Audiobookshelf)
 */
export async function processScanPlex(payload: ScanPlexPayload): Promise<any> {
  const { libraryId, partial, path, jobId } = payload;

  const logger = RMABLogger.forJob(jobId, 'ScanLibrary');

  logger.info(`Scanning library ${libraryId || 'default'}${partial ? ' (partial)' : ''}`);

  try {
    // 1. Get library service (automatically selects Plex or Audiobookshelf based on config)
    const libraryService = await getLibraryService();
    const configService = getConfigService();
    const backendMode = await configService.getBackendMode();
    const thumbnailCacheService = getThumbnailCacheService();

    logger.info(`Backend mode: ${backendMode}`);

    // 2. Get configured library ID
    let targetLibraryId = libraryId;

    if (!targetLibraryId) {
      if (backendMode === 'audiobookshelf') {
        const absLibraryId = await configService.get('audiobookshelf.library_id');
        if (!absLibraryId) {
          throw new Error('Audiobookshelf library not configured');
        }
        targetLibraryId = absLibraryId;
      } else {
        const plexConfig = await configService.getPlexConfig();
        if (!plexConfig.libraryId) {
          throw new Error('Plex audiobook library not configured');
        }
        targetLibraryId = plexConfig.libraryId;
      }
    }

    // Get cover caching parameters (needed for thumbnail caching)
    const coverCachingParams = await (libraryService as any).getCoverCachingParams();

    logger.info(`Fetching content from library ${targetLibraryId}`);

    // 3. Get all audiobooks from library using abstraction layer
    const libraryItems = await libraryService.getLibraryItems(targetLibraryId);

    logger.info(`Found ${libraryItems.length} items in library`);

    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const results: any[] = [];

    // 4. Process each library item - populate plex_library table
    // Note: Table is still called plex_library for backwards compatibility, but now stores items from any backend
    for (const item of libraryItems) {
      if (!item.title || !item.externalId) {
        skippedCount++;
        continue;
      }

      try {
        // Check if this audiobook already exists in plex_library by externalId (plexGuid or abs_item_id)
        const existing = await prisma.plexLibrary.findFirst({
          where: { plexGuid: item.externalId },
        });

        if (existing) {
          // Update existing record with latest data
          await prisma.plexLibrary.update({
            where: { id: existing.id },
            data: {
              title: item.title,
              author: item.author || existing.author,
              narrator: item.narrator || existing.narrator,
              summary: item.description || existing.summary,
              duration: item.duration ? BigInt(Math.round(item.duration * 1000)) : existing.duration, // Convert seconds to milliseconds
              year: item.year || existing.year,
              asin: item.asin || existing.asin,  // Store ASIN from library backend
              isbn: item.isbn || existing.isbn,  // Store ISBN from library backend
              thumbUrl: item.coverUrl || existing.thumbUrl,
              plexLibraryId: targetLibraryId,
              plexRatingKey: item.id || existing.plexRatingKey,
              lastScannedAt: new Date(),
              updatedAt: new Date(),
            },
          });

          // Cache library cover (synchronous with smart skip-if-exists logic)
          if (item.coverUrl && item.externalId) {
            const cachedPath = await thumbnailCacheService.cacheLibraryThumbnail(
              item.externalId,
              item.coverUrl,
              coverCachingParams.backendBaseUrl,
              coverCachingParams.authToken,
              coverCachingParams.backendMode
            );

            // Update database with cached path if successful
            if (cachedPath) {
              await prisma.plexLibrary.update({
                where: { id: existing.id },
                data: { cachedLibraryCoverPath: cachedPath },
              });
            }
          }

          updatedCount++;
        } else {
          // Create new plex_library entry
          const newLibraryItem = await prisma.plexLibrary.create({
            data: {
              plexGuid: item.externalId,
              plexRatingKey: item.id,
              title: item.title,
              author: item.author || 'Unknown Author',
              narrator: item.narrator,
              summary: item.description,
              duration: item.duration ? BigInt(Math.round(item.duration * 1000)) : null, // Convert seconds to milliseconds
              year: item.year,
              asin: item.asin,  // Store ASIN from library backend (Plex or Audiobookshelf)
              isbn: item.isbn,  // Store ISBN from library backend
              thumbUrl: item.coverUrl,
              plexLibraryId: targetLibraryId,
              addedAt: item.addedAt,
              lastScannedAt: new Date(),
            },
          });

          // Cache library cover (synchronous with smart skip-if-exists logic)
          if (item.coverUrl && item.externalId) {
            const cachedPath = await thumbnailCacheService.cacheLibraryThumbnail(
              item.externalId,
              item.coverUrl,
              coverCachingParams.backendBaseUrl,
              coverCachingParams.authToken,
              coverCachingParams.backendMode
            );

            // Update database with cached path if successful
            if (cachedPath) {
              await prisma.plexLibrary.update({
                where: { id: newLibraryItem.id },
                data: { cachedLibraryCoverPath: cachedPath },
              });
            }
          }

          newCount++;
          logger.info(`Added new: "${item.title}" by ${item.author}`);

          results.push({
            id: newLibraryItem.id,
            plexGuid: newLibraryItem.plexGuid,
            title: item.title,
            author: item.author,
          });
        }
      } catch (error) {
        logger.error(`Failed to process "${item.title}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        skippedCount++;
      }
    }

    logger.info(`Scan complete: ${libraryItems.length} items scanned, ${newCount} new, ${updatedCount} updated, ${skippedCount} skipped`);

    // 4b. For Audiobookshelf: Trigger metadata match for items without ASIN
    // This ensures ASIN gets populated so items can be matched against requests
    if (backendMode === 'audiobookshelf') {
      logger.info(`Checking for Audiobookshelf items without ASIN...`);
      const { triggerABSItemMatch, getABSItem } = await import('../services/audiobookshelf/api');
      const { generateFilesHash } = await import('../utils/files-hash');

      const itemsWithoutAsin = libraryItems.filter(item => !item.asin && item.externalId);

      if (itemsWithoutAsin.length > 0) {
        logger.info(`Found ${itemsWithoutAsin.length} items without ASIN, attempting file hash matching...`);

        let fileMatchCount = 0;
        let fuzzyMatchCount = 0;

        for (const item of itemsWithoutAsin) {
          try {
            // 1. Fetch full item details to get file list
            const absItem = await getABSItem(item.externalId);

            // 2. Extract audio filenames and generate hash
            const audioFilenames = absItem.media?.audioFiles?.map((f: any) => f.metadata?.filename).filter(Boolean) || [];
            const itemHash = generateFilesHash(audioFilenames);

            // 3. Query database for matching downloaded request
            let matchedAsin: string | undefined = undefined;

            if (itemHash) {
              const matchedAudiobook = await prisma.audiobook.findFirst({
                where: {
                  filesHash: itemHash,
                  status: 'completed',
                },
                select: {
                  audibleAsin: true,
                  title: true,
                },
              });

              if (matchedAudiobook?.audibleAsin) {
                matchedAsin = matchedAudiobook.audibleAsin;
                logger.info(
                  `File hash match found for "${item.title}" → ASIN: ${matchedAsin} (from "${matchedAudiobook.title}")`
                );
                fileMatchCount++;
              }
            }

            // 4. Trigger metadata match (with ASIN if matched, undefined if not)
            await triggerABSItemMatch(item.externalId, matchedAsin);

            if (matchedAsin) {
              logger.info(`Triggered metadata match with ASIN ${matchedAsin} for: "${item.title}"`);
            } else {
              logger.info(`No file match found, triggering fuzzy metadata match for: "${item.title}"`);
              fuzzyMatchCount++;
            }

          } catch (error) {
            logger.error(
              `Failed to process metadata match for "${item.title}": ${error instanceof Error ? error.message : 'Unknown error'}`
            );
            fuzzyMatchCount++;
          }
        }

        logger.info(
          `Metadata match complete: ${fileMatchCount} file hash matches, ${fuzzyMatchCount} fuzzy matches (ASIN population is async)`
        );
      } else {
        logger.info(`All items have ASIN, no metadata match needed`);
      }
    }

    // 5. Remove stale records from plex_library (items no longer in the actual library)
    // This ensures the database is a fresh snapshot of the library state
    logger.info(`Checking for stale library records...`);

    const scannedPlexGuids = libraryItems
      .filter(item => item.externalId)
      .map(item => item.externalId);

    let staleRemovedCount = 0;
    let audiobooksReset = 0;
    let requestsReset = 0;

    // Safety check: Only remove stale records if we actually scanned items
    // This prevents accidentally deleting everything if the library scan fails or returns empty
    if (scannedPlexGuids.length > 0) {
      // Find all plex_library entries for this library that were NOT seen in this scan
      const staleLibraryItems = await prisma.plexLibrary.findMany({
        where: {
          plexLibraryId: targetLibraryId,
          plexGuid: {
            notIn: scannedPlexGuids,
          },
        },
      });

      if (staleLibraryItems.length > 0) {
      logger.info(`Found ${staleLibraryItems.length} stale library records to remove`);

      // For each stale library item, clean up references
      for (const staleItem of staleLibraryItems) {
        try {
          // Find audiobooks that reference this stale library item
          const linkedAudiobooks = await prisma.audiobook.findMany({
            where: {
              OR: [
                { plexGuid: staleItem.plexGuid },
                { absItemId: staleItem.plexGuid },
              ],
            },
            include: {
              requests: {
                where: { deletedAt: null },
              },
            },
          });

          // Reset audiobook records and their requests
          for (const audiobook of linkedAudiobooks) {
            // Clear library linkage
            const updateData: any = {
              status: 'requested',
              plexGuid: null,
              absItemId: null,
              updatedAt: new Date(),
            };

            await prisma.audiobook.update({
              where: { id: audiobook.id },
              data: updateData,
            });

            audiobooksReset++;

            // Reset any 'available' requests back to 'downloaded' or 'failed'
            for (const request of audiobook.requests) {
              if (request.status === 'available') {
                await prisma.request.update({
                  where: { id: request.id },
                  data: {
                    status: 'downloaded', // Back to downloaded state (files may still be there)
                    updatedAt: new Date(),
                  },
                });
                requestsReset++;
              }
            }

            logger.info(`Reset audiobook "${staleItem.title}" (no longer in library)`);
          }

          // Delete the stale library record
          await prisma.plexLibrary.delete({
            where: { id: staleItem.id },
          });

          staleRemovedCount++;
        } catch (error) {
          logger.error(`Failed to remove stale library item "${staleItem.title}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

        logger.info(`Removed ${staleRemovedCount} stale records, reset ${audiobooksReset} audiobooks and ${requestsReset} requests`);
      } else {
        logger.info(`No stale library records found`);
      }
    } else {
      logger.warn(`Scan returned no items - skipping stale record cleanup to prevent data loss`);
    }

    // 5b. Clean up orphaned audiobooks (audiobooks with plexGuid/absItemId that don't exist in plex_library)
    // This handles cases where the library record was already deleted but audiobook record wasn't updated
    logger.info(`Checking for orphaned audiobooks...`);

    const allPlexGuidsInLibrary = await prisma.plexLibrary.findMany({
      select: { plexGuid: true },
    });
    const validPlexGuids = allPlexGuidsInLibrary.map(item => item.plexGuid);

    let orphanedAudiobooksReset = 0;
    let orphanedRequestsReset = 0;

    // Find audiobooks with plexGuid/absItemId that don't exist in plex_library
    const orphanedAudiobooks = await prisma.audiobook.findMany({
      where: {
        OR: [
          {
            plexGuid: { not: null },
          },
          {
            absItemId: { not: null },
          },
        ],
      },
      include: {
        requests: {
          where: { deletedAt: null },
        },
      },
    });

    for (const audiobook of orphanedAudiobooks) {
      const linkedId = audiobook.plexGuid || audiobook.absItemId;

      // Skip if this audiobook's library ID is valid (exists in plex_library)
      if (linkedId && validPlexGuids.includes(linkedId)) {
        continue;
      }

      // This audiobook is orphaned - its library link points to nothing
      try {
        logger.info(`Found orphaned audiobook: "${audiobook.title}" (linked to non-existent library item)`);

        // Clear library linkage
        await prisma.audiobook.update({
          where: { id: audiobook.id },
          data: {
            status: 'requested',
            plexGuid: null,
            absItemId: null,
            updatedAt: new Date(),
          },
        });

        orphanedAudiobooksReset++;

        // Reset any 'available' requests
        for (const request of audiobook.requests) {
          if (request.status === 'available') {
            await prisma.request.update({
              where: { id: request.id },
              data: {
                status: 'downloaded',
                updatedAt: new Date(),
              },
            });
            orphanedRequestsReset++;
          }
        }
      } catch (error) {
        logger.error(`Failed to reset orphaned audiobook "${audiobook.title}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    if (orphanedAudiobooksReset > 0) {
      logger.info(`Reset ${orphanedAudiobooksReset} orphaned audiobooks and ${orphanedRequestsReset} requests`);
    } else {
      logger.info(`No orphaned audiobooks found`);
    }

    // 6. Match all non-terminal audiobook requests against library
    // Note: Ebook requests don't match to Plex/ABS library - they stop at 'downloaded' status
    logger.info(`Checking for matchable requests...`);
    const matchableRequests = await prisma.request.findMany({
      where: {
        type: 'audiobook', // Only match audiobook requests (ebooks don't go to 'available')
        status: { notIn: ['available', 'cancelled', 'denied'] },
        deletedAt: null,
      },
      include: {
        audiobook: true,
        user: {
          select: {
            plexUsername: true,
          },
        },
      },

    });

    logger.info(`Found ${matchableRequests.length} matchable requests (all non-terminal statuses)`);

    let matchedCount = 0;
    const { findPlexMatch } = await import('../utils/audiobook-matcher');

    for (const request of matchableRequests) {
      try {
        const audiobook = request.audiobook;

        // Use the centralized matcher (handles ASIN matching, title normalization, narrator matching, etc.)
        // Works for both Plex and Audiobookshelf backends
        const match = await findPlexMatch({
          asin: audiobook.audibleAsin || '',
          title: audiobook.title,
          author: audiobook.author,
          narrator: audiobook.narrator || undefined,
        });

        if (match) {
          const originalStatus = request.status;
          logger.info(
            `Match found! "${audiobook.title}" -> "${match.title}"` +
            (originalStatus !== 'downloaded' ? ` (was '${originalStatus}')` : '')
          );

          // Update audiobook with matched library item ID (plexGuid or abs_item_id)
          const updateData: any = { updatedAt: new Date() };

          if (backendMode === 'audiobookshelf') {
            updateData.absItemId = match.plexGuid; // plexGuid field stores the externalId from either backend
          } else {
            updateData.plexGuid = match.plexGuid;
          }

          await prisma.audiobook.update({
            where: { id: audiobook.id },
            data: updateData,
          });

          // Update request to available and clear any error state
          await prisma.request.update({
            where: { id: request.id },
            data: {
              status: 'available',
              completedAt: new Date(),
              errorMessage: null,        // Clear any error state
              searchAttempts: 0,          // Reset retry counters
              downloadAttempts: 0,
              importAttempts: 0,
              updatedAt: new Date(),
            },
          });

          // Send notification that audiobook is now available
          const { getJobQueueService } = await import('../services/job-queue.service');
          const jobQueue = getJobQueueService();
          await jobQueue.addNotificationJob(
            'request_available',
            request.id,
            audiobook.title,
            audiobook.author,
            request.user.plexUsername || 'Unknown User',
            undefined,
            'audiobook'
          ).catch((error) => {
            logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
          });

          matchedCount++;

          // Note: Audiobookshelf metadata matching is handled in the file hash phase above
          // Items without ASIN get file-hash-matched ASIN, items with ASIN already have correct metadata
        }
      } catch (error) {
        logger.error(`Failed to match request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    logger.info(`Matched ${matchedCount}/${matchableRequests.length} requests`, {
      totalScanned: libraryItems.length,
      newCount,
      updatedCount,
      skippedCount,
      staleRemovedCount,
      audiobooksReset,
      requestsReset,
      orphanedAudiobooksReset,
      orphanedRequestsReset,
      matchedDownloads: matchedCount,
    });

    return {
      success: true,
      message: `Library scan completed successfully (${backendMode})`,
      backendMode,
      libraryId: targetLibraryId,
      totalScanned: libraryItems.length,
      newCount,
      updatedCount,
      skippedCount,
      staleRemovedCount,
      audiobooksReset,
      requestsReset,
      orphanedAudiobooksReset,
      orphanedRequestsReset,
      newAudiobooks: results,
      matchedDownloads: matchedCount,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
