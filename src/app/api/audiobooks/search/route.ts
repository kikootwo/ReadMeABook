/**
 * Component: Audiobook Search API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { prisma } from '@/lib/db';
import { compareTwoStrings } from 'string-similarity';

/**
 * GET /api/audiobooks/search?q=query&page=1
 * Search for audiobooks on Audible
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || searchParams.get('query');
    const page = parseInt(searchParams.get('page') || '1', 10);

    if (!query) {
      return NextResponse.json(
        {
          error: 'ValidationError',
          message: 'Search query is required',
        },
        { status: 400 }
      );
    }

    const audibleService = getAudibleService();
    const results = await audibleService.search(query, page);

    // Enrich search results with availability information from database
    const enrichedResults = await Promise.all(
      results.results.map(async (audiobook) => {
        // Check if audiobook exists in database and is available
        const dbAudiobooks = await prisma.audiobook.findMany({
          where: {
            OR: [
              { audibleId: audiobook.asin },
              {
                AND: [
                  { title: { contains: audiobook.title.substring(0, 20), mode: 'insensitive' } },
                  { author: { contains: audiobook.author.substring(0, 20), mode: 'insensitive' } },
                ],
              },
            ],
          },
          select: {
            id: true,
            audibleId: true,
            title: true,
            author: true,
            availabilityStatus: true,
            plexGuid: true,
            availableAt: true,
          },
          take: 5,
        });

        // If exact match by ASIN, use it
        let matchedBook = dbAudiobooks.find((db) => db.audibleId === audiobook.asin);

        // Otherwise, use fuzzy matching
        if (!matchedBook && dbAudiobooks.length > 0) {
          const candidates = dbAudiobooks.map((dbBook) => {
            const titleScore = compareTwoStrings(
              audiobook.title.toLowerCase(),
              dbBook.title.toLowerCase()
            );
            const authorScore = compareTwoStrings(
              audiobook.author.toLowerCase(),
              dbBook.author.toLowerCase()
            );
            const overallScore = titleScore * 0.7 + authorScore * 0.3;

            return { dbBook, score: overallScore };
          });

          candidates.sort((a, b) => b.score - a.score);
          const bestMatch = candidates[0];

          // Accept match if score >= 70%
          if (bestMatch && bestMatch.score >= 0.7) {
            matchedBook = bestMatch.dbBook;
          }
        }

        return {
          ...audiobook,
          availabilityStatus: matchedBook?.availabilityStatus || 'unknown',
          isAvailable: matchedBook?.availabilityStatus === 'available',
          plexGuid: matchedBook?.plexGuid || null,
          dbId: matchedBook?.id || null,
        };
      })
    );

    return NextResponse.json({
      success: true,
      query: results.query,
      results: enrichedResults,
      totalResults: results.totalResults,
      page: results.page,
      hasMore: results.hasMore,
    });
  } catch (error) {
    console.error('Failed to search audiobooks:', error);
    return NextResponse.json(
      {
        error: 'SearchError',
        message: 'Failed to search audiobooks',
      },
      { status: 500 }
    );
  }
}
