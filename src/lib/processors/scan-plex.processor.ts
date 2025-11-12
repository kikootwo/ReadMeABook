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

    let matchedCount = 0;
    let updatedCount = 0;
    const matchResults: any[] = [];

    // 3. Match each Plex audiobook against database audiobooks
    for (const plexBook of plexAudiobooks) {
      if (!plexBook.title) {
        continue;
      }

      // Search for potential matches in database by title similarity
      // First, get all audiobooks to match against (could be optimized with better query)
      const dbAudiobooks = await prisma.audiobook.findMany({
        where: {
          OR: [
            { title: { contains: plexBook.title.substring(0, 20), mode: 'insensitive' } },
            { author: { contains: plexBook.author?.substring(0, 20) || '', mode: 'insensitive' } },
          ],
        },
        take: 50, // Limit to avoid performance issues
      });

      if (dbAudiobooks.length === 0) {
        continue;
      }

      // Fuzzy match to find best candidate
      const candidates = dbAudiobooks.map((dbBook) => {
        const titleScore = compareTwoStrings(
          plexBook.title.toLowerCase(),
          dbBook.title.toLowerCase()
        );
        const authorScore = plexBook.author && dbBook.author
          ? compareTwoStrings(plexBook.author.toLowerCase(), dbBook.author.toLowerCase())
          : 0.5;

        // Weighted average: title is more important
        const overallScore = titleScore * 0.7 + authorScore * 0.3;

        return {
          dbBook,
          score: overallScore,
          titleScore,
          authorScore,
        };
      });

      // Sort by score and get best match
      candidates.sort((a, b) => b.score - a.score);
      const bestMatch = candidates[0];

      // Accept match if score >= 70%
      if (bestMatch && bestMatch.score >= 0.7) {
        matchedCount++;

        // Check if audiobook already has this Plex GUID
        if (bestMatch.dbBook.plexGuid === plexBook.guid) {
          console.log(`[ScanPlex] "${plexBook.title}" already matched (score: ${Math.round(bestMatch.score * 100)}%)`);
          continue;
        }

        console.log(`[ScanPlex] Matched "${plexBook.title}" to database audiobook "${bestMatch.dbBook.title}" (score: ${Math.round(bestMatch.score * 100)}%)`);

        // Update audiobook with Plex info
        await prisma.audiobook.update({
          where: { id: bestMatch.dbBook.id },
          data: {
            plexGuid: plexBook.guid,
            availabilityStatus: 'available',
            availableAt: new Date(),
            plexLibraryId: targetLibraryId,
            updatedAt: new Date(),
          },
        });

        updatedCount++;

        matchResults.push({
          plexTitle: plexBook.title,
          plexAuthor: plexBook.author,
          dbTitle: bestMatch.dbBook.title,
          dbAuthor: bestMatch.dbBook.author,
          matchScore: bestMatch.score,
          audiobookId: bestMatch.dbBook.id,
        });
      }
    }

    console.log(`[ScanPlex] Scan complete: ${plexAudiobooks.length} items scanned, ${matchedCount} matched, ${updatedCount} updated`);

    return {
      success: true,
      message: 'Plex library scan completed successfully',
      libraryId: targetLibraryId,
      totalScanned: plexAudiobooks.length,
      matchedCount,
      updatedCount,
      matches: matchResults,
    };
  } catch (error) {
    console.error('[ScanPlex] Error:', error);
    throw error;
  }
}
