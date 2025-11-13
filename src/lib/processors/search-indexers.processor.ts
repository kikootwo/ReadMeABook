/**
 * Component: Search Indexers Job Processor
 * Documentation: documentation/phase3/README.md
 */

import { SearchIndexersPayload, getJobQueueService } from '../services/job-queue.service';
import { prisma } from '../db';
import { getProwlarrService } from '../integrations/prowlarr.service';
import { getRankingAlgorithm } from '../utils/ranking-algorithm';

/**
 * Process search indexers job
 * Searches configured indexers for audiobook torrents
 */
export async function processSearchIndexers(payload: SearchIndexersPayload): Promise<any> {
  const { requestId, audiobook } = payload;

  console.log(`[SearchIndexers] Processing request ${requestId} for "${audiobook.title}"`);

  try {
    // Update request status to searching
    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'searching',
        searchAttempts: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    // Get Prowlarr service
    const prowlarr = await getProwlarrService();

    // Build search query (title + author for better results)
    const searchQuery = `${audiobook.title} ${audiobook.author}`;

    console.log(`[SearchIndexers] Searching for: "${searchQuery}"`);

    // Search indexers
    const searchResults = await prowlarr.search(searchQuery, {
      category: 3030, // Audiobooks
      minSeeders: 1, // Only torrents with at least 1 seeder
      maxResults: 50, // Limit results
    });

    console.log(`[SearchIndexers] Found ${searchResults.length} results`);

    if (searchResults.length === 0) {
      // No results found - queue for re-search instead of failing
      console.log(`[SearchIndexers] No torrents found for request ${requestId}, marking as awaiting_search`);

      await prisma.request.update({
        where: { id: requestId },
        data: {
          status: 'awaiting_search',
          errorMessage: 'No torrents found. Will retry automatically.',
          lastSearchAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return {
        success: false,
        message: 'No torrents found, queued for re-search',
        requestId,
      };
    }

    // Get ranking algorithm
    const ranker = getRankingAlgorithm();

    // Rank results
    const rankedResults = ranker.rankTorrents(searchResults, {
      title: audiobook.title,
      author: audiobook.author,
      durationMinutes: undefined, // We don't have duration from Audible
    });

    console.log(`[SearchIndexers] Ranked ${rankedResults.length} results`);
    console.log(`[SearchIndexers] Best result: ${rankedResults[0].title} (score: ${rankedResults[0].score})`);

    // Select best result
    const bestResult = rankedResults[0];

    // Log top 3 results for debugging
    rankedResults.slice(0, 3).forEach((r, i) => {
      console.log(`  #${i + 1}: ${r.title} - ${r.score} pts`);
      console.log(`    Format: ${r.breakdown.formatScore}, Seeders: ${r.breakdown.seederScore}, Size: ${r.breakdown.sizeScore}, Match: ${r.breakdown.matchScore}`);
    });

    // Trigger download job with best result
    const jobQueue = getJobQueueService();
    await jobQueue.addDownloadJob(requestId, {
      id: audiobook.id,
      title: audiobook.title,
      author: audiobook.author,
    }, bestResult);

    return {
      success: true,
      message: `Found ${searchResults.length} results, selected best torrent`,
      requestId,
      resultsCount: searchResults.length,
      selectedTorrent: {
        title: bestResult.title,
        score: bestResult.score,
        seeders: bestResult.seeders,
        format: bestResult.format,
      },
    };
  } catch (error) {
    console.error('[SearchIndexers] Error:', error);

    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error during search',
        updatedAt: new Date(),
      },
    });

    throw error;
  }
}
