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
import { createLibraryRowUnlessPresent } from './library-row-insert';
import { matchRequestsToLibrary } from '../services/library/match-requests';

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

    for (const item of recentItems) {
      let existing = await prisma.plexLibrary.findUnique({
        where: { plexGuid: item.externalId },
      });

      if (!existing) {
        const insert = await createLibraryRowUnlessPresent({
          plexGuid: item.externalId,
          plexRatingKey: item.id,
          title: item.title,
          author: item.author || 'Unknown Author',
          narrator: item.narrator,
          summary: item.description,
          duration: item.duration ? BigInt(Math.round(item.duration * 1000)) : null, // Convert seconds to milliseconds
          year: item.year,
          asin: item.asin,  // Store ASIN from library backend
          isbn: item.isbn,  // Store ISBN from library backend
          thumbUrl: item.coverUrl,
          plexLibraryId: libraryId!,
          filePath: item.path, // ABS item folder (request link, #284); Plex: none
          addedAt: item.addedAt,
          lastScannedAt: new Date(),
        });

        if (insert.created) {
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
                where: { id: insert.row.id },
                data: { cachedLibraryCoverPath: cachedPath },
              });
            }
          }

          newCount++;
          logger.info(`New item added: ${item.title} by ${item.author}`);
          continue;
        }

        // Another job inserted this item after our lookup (#222): update its row instead
        existing = insert.row;
        logger.info(`"${item.title}" was just added by another job; updating it`);
      }

      await prisma.plexLibrary.update({
        where: { plexGuid: item.externalId },
        data: {
          title: item.title,
          author: item.author || existing.author,
          narrator: item.narrator || existing.narrator,
          summary: item.description || existing.summary,
          duration: item.duration ? BigInt(Math.round(item.duration * 1000)) : existing.duration,
          year: item.year || existing.year,
          asin: item.asin || existing.asin,  // Update ASIN if available
          isbn: item.isbn || existing.isbn,  // Update ISBN if available
          thumbUrl: item.coverUrl || existing.thumbUrl,
          filePath: item.path ?? existing.filePath, // ABS item folder (request link, #284); Plex: none
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

    // For Audiobookshelf: Trigger metadata match for items without ASIN, and store the ASIN
    // from the match response now (#287), before requests are matched below
    if (backendMode === 'audiobookshelf') {
      const { matchItemsWithoutAsin } = await import('../services/audiobookshelf/match-missing-asins');
      await matchItemsWithoutAsin(recentItems, logger, 'recent items');
    }

    // Match all non-terminal audiobook requests (ASIN; ABS: delivered books by path/hash)
    // Note: Ebook requests don't match to Plex/ABS library - they stop at 'downloaded' status
    const matching = await matchRequestsToLibrary({ backendMode, libraryId, listedItems: recentItems, logger });
    const matchedDownloads = matching.matched;

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
