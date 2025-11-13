/**
 * Component: Popular Audiobooks API Route
 * Documentation: documentation/integrations/audible.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { enrichAudiobooksWithMatches } from '@/lib/utils/audiobook-matcher';

/**
 * GET /api/audiobooks/popular?page=1&limit=20
 * Get popular audiobooks from database cache with pagination
 *
 * NOTE: Uses real-time matching to determine availability status.
 * This ensures matching works regardless of job execution order.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return NextResponse.json(
        {
          error: 'ValidationError',
          message: 'Invalid pagination parameters. Page must be >= 1 and limit must be between 1 and 100.',
        },
        { status: 400 }
      );
    }

    const skip = (page - 1) * limit;

    // Query database for popular audiobooks
    const [audiobooks, totalCount] = await Promise.all([
      prisma.audiobook.findMany({
        where: {
          isPopular: true,
        },
        orderBy: {
          popularRank: 'asc',
        },
        skip,
        take: limit,
        select: {
          id: true,
          audibleId: true,
          title: true,
          author: true,
          narrator: true,
          description: true,
          coverArtUrl: true,
          durationMinutes: true,
          releaseDate: true,
          rating: true,
          genres: true,
          lastAudibleSync: true,
        },
      }),
      prisma.audiobook.count({
        where: {
          isPopular: true,
        },
      }),
    ]);

    // If no data found, return helpful message
    if (totalCount === 0) {
      return NextResponse.json({
        success: true,
        audiobooks: [],
        count: 0,
        totalCount: 0,
        page,
        totalPages: 0,
        hasMore: false,
        message: 'No popular audiobooks found. The Audible data refresh job may need to be run. Please check the Admin Jobs page to enable or trigger the "Audible Data Refresh" job.',
      });
    }

    // Transform to Audible format for matching
    const audibleBooks = audiobooks.map((book) => ({
      asin: book.audibleId || '',
      title: book.title,
      author: book.author,
      narrator: book.narrator || undefined,
      description: book.description || undefined,
      coverArtUrl: book.coverArtUrl || undefined,
      durationMinutes: book.durationMinutes || undefined,
      releaseDate: book.releaseDate?.toISOString() || undefined,
      rating: book.rating ? parseFloat(book.rating.toString()) : undefined,
      genres: (book.genres as string[]) || [],
    }));

    // Enrich with real-time availability matching
    // This matches against ALL database records (Plex scans, previous requests, etc.)
    const enrichedAudiobooks = await enrichAudiobooksWithMatches(audibleBooks);

    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;

    return NextResponse.json({
      success: true,
      audiobooks: enrichedAudiobooks,
      count: enrichedAudiobooks.length,
      totalCount,
      page,
      totalPages,
      hasMore,
      lastSync: audiobooks[0]?.lastAudibleSync?.toISOString() || null,
    });
  } catch (error) {
    console.error('Failed to get popular audiobooks:', error);
    return NextResponse.json(
      {
        error: 'FetchError',
        message: 'Failed to fetch popular audiobooks from database',
      },
      { status: 500 }
    );
  }
}
