/**
 * Component: Library Recently Added Check Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Lightweight polling for new library items (Plex or Audiobookshelf)
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getLibraryService } from '../services/library';
import { getThumbnailCacheService } from '../services/thumbnail-cache.service';

export interface PlexRecentlyAddedPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processPlexRecentlyAddedCheck(payload: PlexRecentlyAddedPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'RecentlyAdded');

  const { getConfigService } = await import('../services/config.service');
  const configService = getConfigService();

  // Get backend mode
  const backendMode = await configService.getBackendMode();
  logger.info(`Backend mode: ${backendMode}`);

  // Validate configuration based on backend mode
  if (backendMode === 'audiobookshelf') {
    const absConfig = await configService.getMany([
      'audiobookshelf.server_url',
      'audiobookshelf.api_token',
      'audiobookshelf.library_id',
    ]);

    const missingFields: string[] = [];
    if (!absConfig['audiobookshelf.server_url']) missingFields.push('Audiobookshelf server URL');
    if (!absConfig['audiobookshelf.api_token']) missingFields.push('Audiobookshelf API token');
    if (!absConfig['audiobookshelf.library_id']) missingFields.push('Audiobookshelf library ID');

    if (missingFields.length > 0) {
      const errorMsg = `Audiobookshelf is not configured. Missing: ${missingFields.join(', ')}`;
      logger.warn(errorMsg);
      return { success: false, message: errorMsg, skipped: true };
    }
  } else {
    const plexConfig = await configService.getMany([
      'plex_url',
      'plex_token',
      'plex_audiobook_library_id',
    ]);

    const missingFields: string[] = [];
    if (!plexConfig.plex_url) missingFields.push('Plex server URL');
    if (!plexConfig.plex_token) missingFields.push('Plex auth token');
    if (!plexConfig.plex_audiobook_library_id) missingFields.push('Plex audiobook library ID');

    if (missingFields.length > 0) {
      const errorMsg = `Plex is not configured. Missing: ${missingFields.join(', ')}`;
      logger.warn(errorMsg);
      return { success: false, message: errorMsg, skipped: true };
    }
  }

  logger.info(`Starting recently added check...`);

  // Get library service (automatically selects Plex or Audiobookshelf)
  const libraryService = await getLibraryService();
  const thumbnailCacheService = getThumbnailCacheService();

  try {
    // Get configured library ID
    const libraryId = backendMode === 'audiobookshelf'
      ? await configService.get('audiobookshelf.library_id')
      : await configService.get('plex_audiobook_library_id');

    // Get cover caching parameters (needed for thumbnail caching)
    const coverCachingParams = await (libraryService as any).getCoverCachingParams();

    // Fetch top 10 recently added items using abstraction layer
    const recentItems = await libraryService.getRecentlyAdded(libraryId!, 10);

    logger.info(`Found ${recentItems.length} recently added items`);

    if (recentItems.length === 0) {
      return { success: true, message: 'No recent items', newCount: 0, updatedCount: 0, matchedDownloads: 0 };
    }

    // Check for new items not in database
    let newCount = 0;
    let updatedCount = 0;
    let matchedDownloads = 0;

    for (const item of recentItems) {
      const existing = await prisma.plexLibrary.findUnique({
        where: { plexGuid: item.externalId },
      });

      if (!existing) {
        const newLibraryItem = await prisma.plexLibrary.create({
          data: {
            plexGuid: item.externalId,
            plexRatingKey: item.id,
            title: item.title,
            author: item.author || 'Unknown Author',
            narrator: item.narrator,
            summary: item.description,
            duration: item.duration ? item.duration * 1000 : null, // Convert seconds to milliseconds
            year: item.year,
            asin: item.asin,  // Store ASIN from library backend
            isbn: item.isbn,  // Store ISBN from library backend
            thumbUrl: item.coverUrl,
            plexLibraryId: libraryId!,
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
        logger.info(`New item added: ${item.title} by ${item.author}`);
      } else {
        await prisma.plexLibrary.update({
          where: { plexGuid: item.externalId },
          data: {
            title: item.title,
            author: item.author || existing.author,
            narrator: item.narrator || existing.narrator,
            summary: item.description || existing.summary,
            duration: item.duration ? item.duration * 1000 : existing.duration,
            year: item.year || existing.year,
            asin: item.asin || existing.asin,  // Update ASIN if available
            isbn: item.isbn || existing.isbn,  // Update ISBN if available
            thumbUrl: item.coverUrl || existing.thumbUrl,
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
              where: { id: existing.id },
              data: { cachedLibraryCoverPath: cachedPath },
            });
          }
        }

        updatedCount++;
      }
    }

    // For Audiobookshelf: Trigger metadata match for items without ASIN
    // This ensures ASIN gets populated so items can be matched against requests
    if (backendMode === 'audiobookshelf') {
      const { triggerABSItemMatch, getABSItem } = await import('../services/audiobookshelf/api');
      const { generateFilesHash } = await import('../utils/files-hash');

      const itemsWithoutAsin = recentItems.filter(item => !item.asin && item.externalId);

      if (itemsWithoutAsin.length > 0) {
        logger.info(`Found ${itemsWithoutAsin.length} recent items without ASIN, attempting file hash matching...`);

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
      }
    }

    // Check for all non-terminal audiobook requests to match
    // Note: Ebook requests don't match to Plex/ABS library - they stop at 'downloaded' status
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
      take: 100,
    });

    if (matchableRequests.length > 0) {
      logger.info(`Checking ${matchableRequests.length} matchable requests for matches (all non-terminal statuses)`);

      const { findPlexMatch } = await import('../utils/audiobook-matcher');

      for (const request of matchableRequests) {
        try {
          const audiobook = request.audiobook;
          const match = await findPlexMatch({
            asin: audiobook.audibleAsin || '',
            title: audiobook.title,
            author: audiobook.author,
            narrator: audiobook.narrator || undefined,
          });

          if (match) {
            const originalStatus = request.status;
            logger.info(
              `Match found: "${audiobook.title}" → "${match.title}"` +
              (originalStatus !== 'downloaded' ? ` (was '${originalStatus}')` : '')
            );

            // Update audiobook with matched library item ID
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

            await prisma.request.update({
              where: { id: request.id },
              data: {
                status: 'available',
                completedAt: new Date(),
                errorMessage: null,
                searchAttempts: 0,
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

            matchedDownloads++;

            // Note: Audiobookshelf metadata matching is handled in the file hash phase above
            // Items without ASIN get file-hash-matched ASIN, items with ASIN already have correct metadata
          }
        } catch (error) {
          logger.error(`Failed to match request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }

    logger.info(`Complete: ${newCount} new, ${updatedCount} updated, ${matchedDownloads} matched requests`);

    return {
      success: true,
      message: `Recently added check completed (${backendMode})`,
      backendMode,
      newCount,
      updatedCount,
      matchedDownloads,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
