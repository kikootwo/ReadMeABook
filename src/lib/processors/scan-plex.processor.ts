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
import { createJobLogger } from '../utils/job-logger';

/**
 * Process library scan job
 * Scans library and updates plex_library table (works for both Plex and Audiobookshelf)
 */
export async function processScanPlex(payload: ScanPlexPayload): Promise<any> {
  const { libraryId, partial, path, jobId } = payload;

  const logger = jobId ? createJobLogger(jobId, 'ScanLibrary') : null;

  await logger?.info(`Scanning library ${libraryId || 'default'}${partial ? ' (partial)' : ''}`);

  try {
    // 1. Get library service (automatically selects Plex or Audiobookshelf based on config)
    const libraryService = await getLibraryService();
    const configService = getConfigService();
    const backendMode = await configService.getBackendMode();

    await logger?.info(`Backend mode: ${backendMode}`);

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

    await logger?.info(`Fetching content from library ${targetLibraryId}`);

    // 3. Get all audiobooks from library using abstraction layer
    const libraryItems = await libraryService.getLibraryItems(targetLibraryId);

    await logger?.info(`Found ${libraryItems.length} items in library`);

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
              duration: item.duration ? item.duration * 1000 : existing.duration, // Convert seconds to milliseconds
              year: item.year || existing.year,
              thumbUrl: item.coverUrl || existing.thumbUrl,
              plexLibraryId: targetLibraryId,
              plexRatingKey: item.id || existing.plexRatingKey,
              lastScannedAt: new Date(),
              updatedAt: new Date(),
            },
          });

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
              duration: item.duration ? item.duration * 1000 : null, // Convert seconds to milliseconds
              year: item.year,
              thumbUrl: item.coverUrl,
              plexLibraryId: targetLibraryId,
              addedAt: item.addedAt,
              lastScannedAt: new Date(),
            },
          });

          newCount++;
          await logger?.info(`Added new: "${item.title}" by ${item.author}`);

          results.push({
            id: newLibraryItem.id,
            plexGuid: newLibraryItem.plexGuid,
            title: item.title,
            author: item.author,
          });
        }
      } catch (error) {
        await logger?.error(`Failed to process "${item.title}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        skippedCount++;
      }
    }

    await logger?.info(`Scan complete: ${libraryItems.length} items scanned, ${newCount} new, ${updatedCount} updated, ${skippedCount} skipped`);

    // 5. Match downloaded requests against library
    await logger?.info(`Checking for downloaded requests to match...`);
    const downloadedRequests = await prisma.request.findMany({
      where: { status: 'downloaded' },
      include: { audiobook: true },
      take: 50, // Limit to prevent overwhelming
    });

    await logger?.info(`Found ${downloadedRequests.length} downloaded requests to match`);

    let matchedCount = 0;
    const { findPlexMatch } = await import('../utils/audiobook-matcher');

    for (const request of downloadedRequests) {
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
          await logger?.info(`Match found! "${audiobook.title}" -> "${match.title}"`);

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

          // Update request to available
          await prisma.request.update({
            where: { id: request.id },
            data: {
              status: 'available',
              completedAt: new Date(),
              updatedAt: new Date(),
            },
          });

          matchedCount++;
        }
      } catch (error) {
        await logger?.error(`Failed to match request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    await logger?.info(`Matched ${matchedCount}/${downloadedRequests.length} downloaded requests`, {
      totalScanned: libraryItems.length,
      newCount,
      updatedCount,
      skippedCount,
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
      newAudiobooks: results,
      matchedDownloads: matchedCount,
    };
  } catch (error) {
    await logger?.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
