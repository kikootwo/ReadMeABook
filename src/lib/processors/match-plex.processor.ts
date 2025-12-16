/**
 * Component: Match Library Job Processor
 * Documentation: documentation/phase3/README.md
 *
 * DEPRECATED: This processor is deprecated. Matching is now handled by scan_library job.
 * Kept for backwards compatibility but should not be used in new code.
 */

import { MatchPlexPayload } from '../services/job-queue.service';
import { prisma } from '../db';
import { getLibraryService } from '../services/library';
import { compareTwoStrings } from 'string-similarity';
import { getConfigService } from '../services/config.service';
import { createJobLogger } from '../utils/job-logger';

/**
 * Process match library job (DEPRECATED - use scan_library instead)
 * Fuzzy matches requested audiobook to library item and updates status
 */
export async function processMatchPlex(payload: MatchPlexPayload): Promise<any> {
  const { requestId, audiobookId, title, author, jobId } = payload;

  const logger = jobId ? createJobLogger(jobId, 'MatchLibrary') : null;

  await logger?.warn('DEPRECATED: match_plex job is deprecated. Use scan_plex instead.');
  await logger?.info(`Matching "${title}" by ${author} in library`);

  try {
    // Get library service and configuration
    const configService = getConfigService();
    const libraryService = await getLibraryService();
    const backendMode = await configService.getBackendMode();

    await logger?.info(`Backend mode: ${backendMode}`);

    // Get configured library ID
    const libraryId = backendMode === 'audiobookshelf'
      ? await configService.get('audiobookshelf.library_id')
      : (await configService.getPlexConfig()).libraryId;

    if (!libraryId) {
      throw new Error(`${backendMode} library not configured`);
    }

    // Search library using abstraction layer
    const searchResults = await libraryService.searchItems(libraryId, title);

    await logger?.info(`Found ${searchResults.length} results in library`);

    if (searchResults.length === 0) {
      await logger?.warn(`No matches found in library for "${title}"`);

      // Mark as completed anyway - the file is there, library just needs time to scan
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'completed',
          updatedAt: new Date(),
          completedAt: new Date(),
        },
      });

      return {
        success: true,
        message: 'No library match found yet, but request completed',
        requestId,
        matched: false,
        note: 'Library may need time to scan the new files',
      };
    }

    // Fuzzy match against results
    const matches = searchResults.map((item) => {
      const titleScore = compareTwoStrings(title.toLowerCase(), (item.title || '').toLowerCase());
      const authorScore = author
        ? compareTwoStrings(author.toLowerCase(), (item.author || '').toLowerCase())
        : 0.5;

      // Weighted average: title is more important
      const overallScore = titleScore * 0.7 + authorScore * 0.3;

      return {
        item,
        score: overallScore,
        titleScore,
        authorScore,
      };
    });

    // Sort by score
    matches.sort((a, b) => b.score - a.score);

    const bestMatch = matches[0];

    await logger?.info(`Best match: "${bestMatch.item.title}" by ${bestMatch.item.author || 'Unknown'}`, {
      score: Math.round(bestMatch.score * 100),
      titleScore: Math.round(bestMatch.titleScore * 100),
      authorScore: Math.round(bestMatch.authorScore * 100),
    });

    // Accept match if score >= 70%
    if (bestMatch.score >= 0.7) {
      await logger?.info(`Match accepted!`);

      // Update audiobook with library item ID
      const updateData: any = {
        completedAt: new Date(),
        updatedAt: new Date(),
      };

      if (backendMode === 'audiobookshelf') {
        updateData.absItemId = bestMatch.item.externalId;
      } else {
        updateData.plexGuid = bestMatch.item.externalId;
      }

      await prisma.audiobook.update({
        where: { id: audiobookId },
        data: updateData,
      });

      // Ensure request is marked as completed
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'completed',
          updatedAt: new Date(),
          completedAt: new Date(),
        },
      });

      return {
        success: true,
        message: `Successfully matched audiobook in library (${backendMode})`,
        backendMode,
        requestId,
        matched: true,
        matchScore: bestMatch.score,
        libraryItem: {
          title: bestMatch.item.title,
          author: bestMatch.item.author,
          id: bestMatch.item.id,
          externalId: bestMatch.item.externalId,
        },
      };
    } else {
      await logger?.warn(`Match score too low (${Math.round(bestMatch.score * 100)}%), but marking as completed anyway`);

      // Mark as completed even if match is poor
      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'completed',
          updatedAt: new Date(),
          completedAt: new Date(),
        },
      });

      return {
        success: true,
        message: 'Request completed, but library match uncertain',
        requestId,
        matched: false,
        matchScore: bestMatch.score,
        note: `Low match score: ${Math.round(bestMatch.score * 100)}%`,
      };
    }
  } catch (error) {
    await logger?.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);

    // Don't fail the request - the files are organized correctly
    // Just log the error and mark as completed
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'completed',
        errorMessage: `Library matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        updatedAt: new Date(),
        completedAt: new Date(),
      },
    });

    return {
      success: false,
      message: 'Request completed despite library matching error',
      requestId,
      matched: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
