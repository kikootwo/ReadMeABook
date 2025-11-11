/**
 * Component: Match Plex Job Processor
 * Documentation: documentation/backend/services/jobs.md
 */

import { MatchPlexPayload } from '../services/job-queue.service';
import { prisma } from '../db';

/**
 * Process match Plex job
 * Fuzzy matches requested audiobook to Plex library item and updates status
 */
export async function processMatchPlex(payload: MatchPlexPayload): Promise<any> {
  const { requestId, audiobookId, title, author } = payload;

  console.log(`[MatchPlex] Matching "${title}" by ${author} in Plex`);

  try {
    // TODO: Implementation in Phase 3
    // 1. Get Plex configuration
    // 2. Get all audiobooks from Plex library
    // 3. Run fuzzy matching algorithm
    // 4. If match found (score >= 80):
    //    - Update audiobook with Plex GUID
    //    - Update request status to 'completed'
    //    - Set availableAt timestamp
    // 5. If no match, retry or mark for manual review

    // Placeholder return
    return {
      success: true,
      message: 'Match Plex processor - Implementation pending Phase 3',
      requestId,
      matched: false,
    };
  } catch (error) {
    console.error('[MatchPlex] Error:', error);

    await prisma.request.update({
      where: { id: requestId },
      data: {
        status: 'failed',
        errorMessage: `Failed to match in Plex: ${error instanceof Error ? error.message : 'Unknown error'}`,
        updatedAt: new Date(),
      },
    });

    throw error;
  }
}
