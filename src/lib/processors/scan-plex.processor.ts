/**
 * Component: Scan Plex Job Processor
 * Documentation: documentation/backend/services/jobs.md
 *
 * Scans Plex library and populates plex_library table with all audiobooks.
 */

import { ScanPlexPayload } from '../services/job-queue.service';
import { prisma } from '../db';
import { getPlexService } from '../integrations/plex.service';
import { getConfigService } from '../services/config.service';
import { createJobLogger } from '../utils/job-logger';

/**
 * Process scan Plex job
 * Scans Plex library and updates plex_library table
 */
export async function processScanPlex(payload: ScanPlexPayload): Promise<any> {
  const { libraryId, partial, path, jobId } = payload;

  const logger = jobId ? createJobLogger(jobId, 'ScanPlex') : null;

  await logger?.info(`Scanning library ${libraryId || 'default'}${partial ? ' (partial)' : ''}`);

  try {
    // 1. Get Plex configuration
    const configService = getConfigService();
    const plexConfig = await configService.getPlexConfig();

    if (!plexConfig.serverUrl || !plexConfig.authToken) {
      throw new Error('Plex is not configured');
    }

    // Use configured library ID if not provided in payload
    const targetLibraryId = libraryId || plexConfig.libraryId;
    if (!targetLibraryId) {
      throw new Error('Plex audiobook library not configured');
    }

    await logger?.info(`Fetching content from Plex library ${targetLibraryId}`);

    // 2. Get all audiobooks from Plex library
    const plexService = getPlexService();
    const plexAudiobooks = await plexService.getLibraryContent(
      plexConfig.serverUrl,
      plexConfig.authToken,
      targetLibraryId
    );

    await logger?.info(`Found ${plexAudiobooks.length} items in Plex library`);

    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const results: any[] = [];

    // 3. Process each Plex audiobook - populate plex_library table
    for (const plexBook of plexAudiobooks) {
      if (!plexBook.title || !plexBook.guid) {
        skippedCount++;
        continue;
      }

      try {
        // Check if this Plex audiobook already exists in plex_library by plexGuid
        const existing = await prisma.plexLibrary.findFirst({
          where: { plexGuid: plexBook.guid },
        });

        if (existing) {
          // Update existing record with latest Plex data
          await prisma.plexLibrary.update({
            where: { id: existing.id },
            data: {
              title: plexBook.title,
              author: plexBook.author || existing.author,
              narrator: plexBook.narrator || existing.narrator,
              summary: plexBook.summary || existing.summary,
              duration: plexBook.duration || existing.duration,
              year: plexBook.year || existing.year,
              filePath: plexBook.filePath || existing.filePath,
              thumbUrl: plexBook.thumb || existing.thumbUrl,
              plexLibraryId: targetLibraryId,
              plexRatingKey: plexBook.ratingKey || existing.plexRatingKey,
              lastScannedAt: new Date(),
              updatedAt: new Date(),
            },
          });

          updatedCount++;
        } else {
          // Create new plex_library entry
          const newPlexBook = await prisma.plexLibrary.create({
            data: {
              plexGuid: plexBook.guid,
              plexRatingKey: plexBook.ratingKey,
              title: plexBook.title,
              author: plexBook.author || 'Unknown Author',
              narrator: plexBook.narrator,
              summary: plexBook.summary,
              duration: plexBook.duration,
              year: plexBook.year,
              filePath: plexBook.filePath,
              thumbUrl: plexBook.thumb,
              plexLibraryId: targetLibraryId,
              addedAt: plexBook.addedAt ? new Date(plexBook.addedAt * 1000) : new Date(),
              lastScannedAt: new Date(),
            },
          });

          newCount++;
          await logger?.info(`Added new: "${plexBook.title}" by ${plexBook.author}`);

          results.push({
            id: newPlexBook.id,
            plexGuid: newPlexBook.plexGuid,
            title: plexBook.title,
            author: plexBook.author,
          });
        }
      } catch (error) {
        await logger?.error(`Failed to process "${plexBook.title}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        skippedCount++;
      }
    }

    await logger?.info(`Scan complete: ${plexAudiobooks.length} items scanned, ${newCount} new, ${updatedCount} updated, ${skippedCount} skipped`);

    // 4. Match downloaded requests against Plex library
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
        const match = await findPlexMatch({
          asin: audiobook.audibleAsin || '',
          title: audiobook.title,
          author: audiobook.author,
          narrator: audiobook.narrator || undefined,
        });

        if (match) {
          await logger?.info(`Match found! "${audiobook.title}" -> "${match.title}"`);

          // Update audiobook with Plex info
          await prisma.audiobook.update({
            where: { id: audiobook.id },
            data: {
              plexGuid: match.plexGuid,
              updatedAt: new Date(),
            },
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
      totalScanned: plexAudiobooks.length,
      newCount,
      updatedCount,
      skippedCount,
      matchedDownloads: matchedCount,
    });

    return {
      success: true,
      message: 'Plex library scan completed successfully',
      libraryId: targetLibraryId,
      totalScanned: plexAudiobooks.length,
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
