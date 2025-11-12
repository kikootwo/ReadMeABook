/**
 * Component: Scan Plex Job Processor
 * Documentation: documentation/backend/services/jobs.md
 */

import { ScanPlexPayload } from '../services/job-queue.service';
import { prisma } from '../db';
import { getPlexService } from '../integrations/plex.service';
import { getConfigService } from '../services/config.service';
import { compareTwoStrings } from 'string-similarity';

/**
 * Process scan Plex job
 * Scans Plex library and updates availability status for matching audiobooks
 */
export async function processScanPlex(payload: ScanPlexPayload): Promise<any> {
  const { libraryId, partial, path } = payload;

  console.log(`[ScanPlex] Scanning library ${libraryId}${partial ? ' (partial)' : ''}`);

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

    console.log(`[ScanPlex] Fetching content from Plex library ${targetLibraryId}`);

    // 2. Get all audiobooks from Plex library
    const plexService = getPlexService();
    const plexAudiobooks = await plexService.getLibraryContent(
      plexConfig.serverUrl,
      plexConfig.authToken,
      targetLibraryId
    );

    console.log(`[ScanPlex] Found ${plexAudiobooks.length} items in Plex library`);

    let newCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const results: any[] = [];

    // 3. Process each Plex audiobook - save to database if not exists, update if exists
    for (const plexBook of plexAudiobooks) {
      if (!plexBook.title) {
        skippedCount++;
        continue;
      }

      try {
        // Check if this Plex audiobook already exists in database by plexGuid
        const existing = await prisma.audiobook.findFirst({
          where: { plexGuid: plexBook.guid },
        });

        if (existing) {
          // Update existing record with latest Plex data
          await prisma.audiobook.update({
            where: { id: existing.id },
            data: {
              title: plexBook.title,
              author: plexBook.author || existing.author,
              narrator: plexBook.narrator || existing.narrator,
              description: plexBook.summary || existing.description,
              plexLibraryId: targetLibraryId,
              availabilityStatus: 'available',
              availableAt: existing.availableAt || new Date(),
              updatedAt: new Date(),
            },
          });

          updatedCount++;
          console.log(`[ScanPlex] Updated: "${plexBook.title}"`);
        } else {
          // Create new audiobook entry from Plex data
          const newAudiobook = await prisma.audiobook.create({
            data: {
              plexGuid: plexBook.guid,
              title: plexBook.title,
              author: plexBook.author || 'Unknown Author',
              narrator: plexBook.narrator,
              description: plexBook.summary,
              durationMinutes: plexBook.duration ? Math.round(plexBook.duration / 60000) : null,
              plexLibraryId: targetLibraryId,
              availabilityStatus: 'available',
              availableAt: new Date(),
            },
          });

          newCount++;
          console.log(`[ScanPlex] Added new: "${plexBook.title}" by ${plexBook.author}`);

          results.push({
            id: newAudiobook.id,
            title: plexBook.title,
            author: plexBook.author,
          });
        }
      } catch (error) {
        console.error(`[ScanPlex] Failed to process "${plexBook.title}":`, error);
        skippedCount++;
      }
    }

    console.log(`[ScanPlex] Scan complete: ${plexAudiobooks.length} items scanned, ${newCount} new, ${updatedCount} updated, ${skippedCount} skipped`);

    return {
      success: true,
      message: 'Plex library scan completed successfully',
      libraryId: targetLibraryId,
      totalScanned: plexAudiobooks.length,
      newCount,
      updatedCount,
      skippedCount,
      newAudiobooks: results,
    };
  } catch (error) {
    console.error('[ScanPlex] Error:', error);
    throw error;
  }
}
