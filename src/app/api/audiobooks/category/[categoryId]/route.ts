/**
 * Component: Category Audiobooks API Route
 * Documentation: documentation/features/home-sections.md
 *
 * Serves audiobooks for a specific Audible category from AudibleCacheCategory,
 * with the same enrichment pattern as popular/new-releases routes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { enrichAudiobooksWithMatches, getAvailableAsins } from '@/lib/utils/audiobook-matcher';
import { getOptionalAuthUser } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { annotateWithIgnoreStatus } from '@/lib/utils/ignored-audiobooks';

const logger = RMABLogger.create('API.Audiobooks.Category');

/**
 * GET /api/audiobooks/category/[categoryId]?page=1&limit=20&hideAvailable=false
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  try {
    const { categoryId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const hideAvailable = searchParams.get('hideAvailable') === 'true';

    if (page < 1 || limit < 1 || limit > 100) {
      return NextResponse.json(
        { error: 'ValidationError', message: 'Invalid pagination parameters.' },
        { status: 400 }
      );
    }

    const skip = (page - 1) * limit;

    // Get excluded ASINs when hideAvailable
    let excludedAsins: string[] = [];
    if (hideAvailable) {
      const availableSet = await getAvailableAsins();
      excludedAsins = [...availableSet];
    }

    // Query AudibleCacheCategory joined with AudibleCache
    const whereClause: any = { categoryId };
    if (excludedAsins.length > 0) {
      whereClause.asin = { notIn: excludedAsins };
    }

    const [categoryEntries, totalCount] = await Promise.all([
      prisma.audibleCacheCategory.findMany({
        where: whereClause,
        orderBy: { rank: 'asc' },
        skip,
        take: limit,
        select: { asin: true, rank: true },
      }),
      prisma.audibleCacheCategory.count({ where: whereClause }),
    ]);

    if (totalCount === 0) {
      return NextResponse.json({
        success: true,
        audiobooks: [],
        count: 0,
        totalCount: 0,
        page,
        totalPages: 0,
        hasMore: false,
        message: 'No audiobooks found for this category. Data may not have been refreshed yet.',
      });
    }

    // Fetch full metadata from AudibleCache for these ASINs
    const asins = categoryEntries.map((e) => e.asin);
    const cacheEntries = await prisma.audibleCache.findMany({
      where: { asin: { in: asins } },
      select: {
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
    });

    // Build a map for ordering by rank
    const cacheMap = new Map(cacheEntries.map((e) => [e.asin, e]));

    // Transform to matcher input format, preserving rank order
    const audibleBooks = categoryEntries
      .map((entry) => {
        const book = cacheMap.get(entry.asin);
        if (!book) return null;

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
      })
      .filter(Boolean) as any[];

    // Enrich with library matching; request details and ignore flags only for a checked account
    const userId = (await getOptionalAuthUser(request))?.id;
    const enrichedAudiobooks = await enrichAudiobooksWithMatches(audibleBooks, userId);

    // Annotate with per-user ignore status
    const annotatedAudiobooks = await annotateWithIgnoreStatus(enrichedAudiobooks, userId);

    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;

    return NextResponse.json({
      success: true,
      audiobooks: annotatedAudiobooks,
      count: enrichedAudiobooks.length,
      totalCount,
      page,
      totalPages,
      hasMore,
      lastSync: cacheEntries[0]?.lastSyncedAt?.toISOString() || null,
    });
  } catch (error) {
    logger.error('Failed to get category audiobooks', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'FetchError', message: 'Failed to fetch category audiobooks' },
      { status: 500 }
    );
  }
}
