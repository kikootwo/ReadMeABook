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

    if (!lastSwipe.recommendation) {
      return NextResponse.json(
        { error: 'Recommendation no longer exists' },
        { status: 404 }
      );
    }

    // Find the oldest existing unswiped recommendation to determine where to insert
    const oldestRecommendation = await prisma.bookDateRecommendation.findFirst({
      where: {
        userId,
        swipes: {
          none: {},
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Set createdAt to be before the oldest recommendation (so it appears at the front)
    // If no recommendations exist, set it to 1 day ago
    const undoCreatedAt = oldestRecommendation
      ? new Date(oldestRecommendation.createdAt.getTime() - 1000) // 1 second before oldest
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago if none exist

    // Delete the swipe (this makes the recommendation visible again)
    await prisma.bookDateSwipe.delete({
      where: { id: lastSwipe.id },
    });

    // Update the recommendation's createdAt to put it at the front of the stack
    const restoredRecommendation = await prisma.bookDateRecommendation.update({
      where: { id: lastSwipe.recommendation.id },
      data: {
        createdAt: undoCreatedAt,
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
