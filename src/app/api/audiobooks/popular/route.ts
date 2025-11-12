/**
 * Component: Popular Audiobooks API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { prisma } from '@/lib/db';
import { compareTwoStrings } from 'string-similarity';

/**
 * GET /api/audiobooks/popular?limit=20
 * Get popular audiobooks from Audible with availability status
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const audibleService = getAudibleService();
    const audiobooks = await audibleService.getPopularAudiobooks(limit);

    // Enrich audiobooks with availability information from database
    const enrichedAudiobooks = await Promise.all(
      audiobooks.map(async (audiobook) => {
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
      audiobooks: enrichedAudiobooks,
      count: enrichedAudiobooks.length,
    });
  } catch (error) {
    console.error('Failed to get popular audiobooks:', error);
    return NextResponse.json(
      {
        error: 'FetchError',
        message: 'Failed to fetch popular audiobooks',
      },
      { status: 500 }
    );
  }
}
