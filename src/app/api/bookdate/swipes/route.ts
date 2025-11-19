/**
 * BookDate: Clear Swipe History (Admin Only)
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

// DELETE: Clear all users' swipe history (Admin only)
async function clearSwipes(req: AuthenticatedRequest) {
  try {
    // Delete all swipes for ALL users (global admin action)
    await prisma.bookDateSwipe.deleteMany({});

    // Also clear all cached recommendations (since swipe history affects recommendations)
    await prisma.bookDateRecommendation.deleteMany({});

    console.log('[BookDate] Admin cleared all swipe history and recommendations');

    return NextResponse.json({
      success: true,
      message: 'All swipe history cleared',
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
  return requireAuth(req, async (authReq) => requireAdmin(authReq, clearSwipes));
}
