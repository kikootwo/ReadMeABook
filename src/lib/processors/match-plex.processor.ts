/**
 * Component: Match Plex Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { MatchPlexPayload } from '../services/job-queue.service';
import { prisma } from '../db';
import { getPlexService } from '../integrations/plex.service';
import { compareTwoStrings } from 'string-similarity';
import { getConfigService } from '../services/config.service';
import { createJobLogger } from '../utils/job-logger';

/**
 * Process match Plex job
 * Fuzzy matches requested audiobook to Plex library item and updates status
 */
export async function processMatchPlex(payload: MatchPlexPayload): Promise<any> {
  const { requestId, audiobookId, title, author, jobId } = payload;

  const logger = jobId ? createJobLogger(jobId, 'MatchPlex') : null;

  await logger?.info(`Matching "${title}" by ${author} in Plex`);

  try {
    // Get Plex configuration
    const configService = getConfigService();
    const plexConfig = await configService.getPlexConfig();

    if (!plexConfig.serverUrl || !plexConfig.authToken) {
      throw new Error('Plex is not configured');
    }

    // Get audiobook library ID
    const libraryId = plexConfig.libraryId;
    if (!libraryId) {
      throw new Error('Plex audiobook library not configured');
    }

    // Search Plex library
    const plexService = getPlexService();
    const searchResults = await plexService.searchLibrary(
      plexConfig.serverUrl,
      plexConfig.authToken,
      libraryId,
      title
    );

    await logger?.info(`Found ${searchResults.length} results in Plex library`);

    if (searchResults.length === 0) {
      await logger?.warn(`No matches found in Plex for "${title}"`);

      // Mark as completed anyway - the file is there, Plex just needs time to scan
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
        message: 'No Plex match found yet, but request completed',
        requestId,
        matched: false,
        note: 'Plex may need time to scan the new files',
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

      // Update audiobook with Plex info
      await prisma.audiobook.update({
        where: { id: audiobookId },
        data: {
          plexGuid: bestMatch.item.guid,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
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
        message: 'Successfully matched audiobook in Plex',
        requestId,
        matched: true,
        matchScore: bestMatch.score,
        plexItem: {
          title: bestMatch.item.title,
          author: bestMatch.item.author,
          ratingKey: bestMatch.item.ratingKey,
          guid: bestMatch.item.guid,
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
        message: 'Request completed, but Plex match uncertain',
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
        errorMessage: `Plex matching failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        updatedAt: new Date(),
        completedAt: new Date(),
      },
    });

    return {
      success: false,
      message: 'Request completed despite Plex matching error',
      requestId,
      matched: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
