/**
 * Component: Audiobook Covers API Route
 * Documentation: documentation/frontend/pages/login.md
 *
 * Serves random popular audiobook covers for login page floating animations
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/audiobooks/covers?count=100
 * Get random popular audiobook covers for login page
 *
 * Returns lightweight cover data without matching overhead.
 * Returns up to 200 covers for immersive login screen experience.
 */
export async function GET() {
  try {
    // Fetch all popular audiobooks with covers (up to 200)
    const audiobooks = await prisma.audibleCache.findMany({
      where: {
        isPopular: true,
        cachedCoverPath: {
          not: null,
        },
      },
      orderBy: {
        popularRank: 'asc',
      },
      take: 200,
      select: {
        asin: true,
        title: true,
        author: true,
        cachedCoverPath: true,
        coverArtUrl: true,
      },
    });

    // Transform to cover URLs
    const covers = audiobooks.map((book) => {
      // Prefer cached cover, fallback to original URL
      let coverUrl = book.coverArtUrl || '';
      if (book.cachedCoverPath) {
        const filename = book.cachedCoverPath.split('/').pop();
        coverUrl = `/api/cache/thumbnails/${filename}`;
      }

      return {
        asin: book.asin,
        title: book.title,
        author: book.author,
        coverUrl,
      };
    });

    // Shuffle for random distribution
    const shuffled = covers.sort(() => Math.random() - 0.5);

    return NextResponse.json({
      success: true,
      covers: shuffled,
      count: shuffled.length,
    });
  } catch (error) {
    console.error('Failed to get audiobook covers:', error);

    // Return empty array on error (login page will show placeholders)
    return NextResponse.json({
      success: false,
      covers: [],
      count: 0,
    });
  }
}
