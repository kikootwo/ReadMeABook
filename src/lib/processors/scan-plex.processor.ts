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

/**
 * Process scan Plex job
 * Scans Plex library and updates plex_library table
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
          console.log(`[ScanPlex] Updated: "${plexBook.title}" by ${plexBook.author}`);
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
          console.log(`[ScanPlex] Added new: "${plexBook.title}" by ${plexBook.author}`);

          results.push({
            id: newPlexBook.id,
            plexGuid: newPlexBook.plexGuid,
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

    // 4. Match downloaded requests against Plex library
    console.log(`[ScanPlex] Checking for downloaded requests to match...`);
    const downloadedRequests = await prisma.request.findMany({
      where: { status: 'downloaded' },
      include: { audiobook: true },
      take: 50, // Limit to prevent overwhelming
    });

    console.log(`[ScanPlex] Found ${downloadedRequests.length} downloaded requests to match`);

    let matchedCount = 0;
    const { compareTwoStrings } = await import('string-similarity');

    for (const request of downloadedRequests) {
      try {
        const audiobook = request.audiobook;
        const title = audiobook.title.toLowerCase();
        const author = (audiobook.author || '').toLowerCase();

        // Search for matching Plex library entries
        const potentialMatches = await prisma.plexLibrary.findMany({
          where: {
            OR: [
              { title: { contains: audiobook.title, mode: 'insensitive' } },
              { author: { contains: audiobook.author || '', mode: 'insensitive' } },
            ],
          },
          take: 10,
        });

        if (potentialMatches.length === 0) {
          console.log(`[ScanPlex] No potential matches for "${audiobook.title}" by ${audiobook.author}`);
          continue;
        }

        // Fuzzy match to find best match
        const matches = potentialMatches.map((plexItem) => {
          const titleScore = compareTwoStrings(title, (plexItem.title || '').toLowerCase());
          const authorScore = author
            ? compareTwoStrings(author, (plexItem.author || '').toLowerCase())
            : 0.5;
          const overallScore = titleScore * 0.7 + authorScore * 0.3;

          return { plexItem, score: overallScore };
        });

        matches.sort((a, b) => b.score - a.score);
        const bestMatch = matches[0];

        // Accept match if score >= 70%
        if (bestMatch.score >= 0.7) {
          console.log(`[ScanPlex] Match found! "${audiobook.title}" -> "${bestMatch.plexItem.title}" (${Math.round(bestMatch.score * 100)}%)`);

          // Update audiobook with Plex info
          await prisma.audiobook.update({
            where: { id: audiobook.id },
            data: {
              plexGuid: bestMatch.plexItem.plexGuid,
              updatedAt: new Date(),
            },
          });

          // Update request to available
          await prisma.request.update({
            where: { id: request.id },
            data: {
              status: 'available',
              updatedAt: new Date(),
            },
          });

          matchedCount++;
        } else {
          console.log(`[ScanPlex] Low match score (${Math.round(bestMatch.score * 100)}%) for "${audiobook.title}"`);
        }
      } catch (error) {
        console.error(`[ScanPlex] Failed to match request ${request.id}:`, error);
      }
    }

    console.log(`[ScanPlex] Matched ${matchedCount}/${downloadedRequests.length} downloaded requests`);

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
    console.error('[ScanPlex] Error:', error);
    throw error;
  }
}
