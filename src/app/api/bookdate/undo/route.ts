/**
 * BookDate: Undo Last Swipe
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

async function handler(req: AuthenticatedRequest) {
  try {
    const userId = req.user!.id;

    // Get last swipe (left or up only - can't undo right swipes)
    const lastSwipe = await prisma.bookDateSwipe.findFirst({
      where: {
        userId,
        action: {
          in: ['left', 'up'],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        recommendation: true,
      },
    });

    if (!lastSwipe) {
      return NextResponse.json(
        { error: 'No swipe to undo' },
        { status: 404 }
      );
    }

    // Restore recommendation to cache (if original recommendation still exists)
    if (lastSwipe.recommendation) {
      // Re-create the recommendation
      await prisma.bookDateRecommendation.create({
        data: {
          userId: lastSwipe.recommendation.userId,
          batchId: lastSwipe.recommendation.batchId,
          title: lastSwipe.recommendation.title,
          author: lastSwipe.recommendation.author,
          narrator: lastSwipe.recommendation.narrator,
          rating: lastSwipe.recommendation.rating,
          description: lastSwipe.recommendation.description,
          coverUrl: lastSwipe.recommendation.coverUrl,
          audnexusAsin: lastSwipe.recommendation.audnexusAsin,
          aiReason: lastSwipe.recommendation.aiReason,
        },
      });
    } else {
      // If recommendation doesn't exist (e.g., was manually deleted),
      // recreate a basic recommendation from swipe data
      await prisma.bookDateRecommendation.create({
        data: {
          userId,
          batchId: `undo_${Date.now()}`,
          title: lastSwipe.bookTitle,
          author: lastSwipe.bookAuthor,
          narrator: null,
          rating: null,
          description: null,
          coverUrl: null,
          audnexusAsin: null,
          aiReason: 'Previously dismissed',
        },
      });
    }

    // Delete the swipe
    await prisma.bookDateSwipe.delete({
      where: { id: lastSwipe.id },
    });

    // Get the restored recommendation
    const restoredRecommendation = await prisma.bookDateRecommendation.findFirst({
      where: {
        userId,
        title: lastSwipe.bookTitle,
        author: lastSwipe.bookAuthor,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return NextResponse.json({
      success: true,
      recommendation: restoredRecommendation,
    });

  } catch (error: any) {
    console.error('[BookDate] Undo error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to undo swipe' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return requireAuth(req, handler);
}
