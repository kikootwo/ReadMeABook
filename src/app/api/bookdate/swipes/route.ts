/**
 * BookDate: Clear Swipe History
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

// DELETE: Clear user's swipe history
async function clearSwipes(req: AuthenticatedRequest) {
  try {
    const userId = req.user!.id;

    // Delete all swipes for this user
    await prisma.bookDateSwipe.deleteMany({
      where: { userId },
    });

    // Also clear cached recommendations (since swipe history affects recommendations)
    await prisma.bookDateRecommendation.deleteMany({
      where: { userId },
    });

    return NextResponse.json({
      success: true,
      message: 'Swipe history cleared',
    });

  } catch (error: any) {
    console.error('[BookDate] Clear swipes error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to clear swipe history' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  return requireAuth(req, clearSwipes);
}
