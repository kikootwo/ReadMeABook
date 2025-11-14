/**
 * Component: Interactive Search API
 * Documentation: documentation/phase3/prowlarr.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getProwlarrService } from '@/lib/integrations/prowlarr.service';
import { rankTorrents } from '@/lib/utils/ranking-algorithm';

/**
 * POST /api/requests/[id]/interactive-search
 * Search for torrents and return results for user selection
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const { id } = await params;

      const requestRecord = await prisma.request.findUnique({
        where: { id },
        include: {
          audiobook: true,
        },
      });

      if (!requestRecord) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Request not found' },
          { status: 404 }
        );
      }

      // Check authorization
      if (requestRecord.userId !== req.user.id && req.user.role !== 'admin') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'You do not have access to this request' },
          { status: 403 }
        );
      }

      // Search Prowlarr for torrents
      const prowlarr = await getProwlarrService();
      const searchQuery = `${requestRecord.audiobook.title} ${requestRecord.audiobook.author}`;

      console.log(`[InteractiveSearch] Searching for: ${searchQuery}`);

      const results = await prowlarr.search(searchQuery);

      if (results.length === 0) {
        return NextResponse.json({
          success: true,
          results: [],
          message: 'No torrents found',
        });
      }

      // Rank torrents using the ranking algorithm
      const rankedResults = rankTorrents(results, {
        title: requestRecord.audiobook.title,
        author: requestRecord.audiobook.author,
      });

      // Add rank position to each result
      const resultsWithRank = rankedResults.map((result, index) => ({
        ...result,
        rank: index + 1,
      }));

      console.log(`[InteractiveSearch] Found ${resultsWithRank.length} results for request ${id}`);

      return NextResponse.json({
        success: true,
        results: resultsWithRank,
        message: `Found ${resultsWithRank.length} torrents`,
      });
    } catch (error) {
      console.error('Failed to perform interactive search:', error);
      return NextResponse.json(
        {
          error: 'SearchError',
          message: error instanceof Error ? error.message : 'Failed to search for torrents',
        },
        { status: 500 }
      );
    }
  });
}
