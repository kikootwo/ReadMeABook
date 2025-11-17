/**
 * Component: Popular Audiobooks API Route
 * Documentation: documentation/integrations/audible.md
 *
 * Serves popular audiobooks from audible_cache with real-time Plex matching
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { enrichAudiobooksWithMatches } from '@/lib/utils/audiobook-matcher';
import { getCurrentUser } from '@/lib/middleware/auth';

/**
 * GET /api/audiobooks/popular?page=1&limit=20
 * Get popular audiobooks from audible_cache with pagination
 *
 * Real-time matching against plex_library determines availability.
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

    // Query audible_cache for popular audiobooks
    const [audiobooks, totalCount] = await Promise.all([
      prisma.audibleCache.findMany({
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
          asin: true,
          title: true,
          author: true,
          narrator: true,
          description: true,
          coverArtUrl: true,
          cachedCoverPath: true,
          durationMinutes: true,
          releaseDate: true,
          rating: true,
          genres: true,
          lastSyncedAt: true,
        },
      }),
      prisma.audibleCache.count({
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

    // Transform to matcher input format (uses ASIN as required field)
    // Use cached cover path when available, otherwise fall back to coverArtUrl
    const audibleBooks = audiobooks.map((book) => {
      // Convert cached path to API URL if it exists
      let coverUrl = book.coverArtUrl || undefined;
      if (book.cachedCoverPath) {
        const filename = book.cachedCoverPath.split('/').pop();
        coverUrl = `/api/cache/thumbnails/${filename}`;
      }

      return {
        asin: book.asin,
        title: book.title,
        author: book.author,
        narrator: book.narrator || undefined,
        description: book.description || undefined,
        coverArtUrl: coverUrl,
        durationMinutes: book.durationMinutes || undefined,
        releaseDate: book.releaseDate?.toISOString() || undefined,
        rating: book.rating ? parseFloat(book.rating.toString()) : undefined,
        genres: (book.genres as string[]) || [],
      };
    });

    // Get current user (optional - for request status enrichment)
    const currentUser = getCurrentUser(request);
    const userId = currentUser?.sub || undefined;

    // Enrich with real-time Plex library matching and request status
    const enrichedAudiobooks = await enrichAudiobooksWithMatches(audibleBooks, userId);

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
      lastSync: audiobooks[0]?.lastSyncedAt?.toISOString() || null,
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
