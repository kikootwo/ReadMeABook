/**
 * BookDate: Admin Global Toggle
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

async function handler(req: AuthenticatedRequest) {
  try {
    const body = await req.json();
    const { isEnabled } = body;

    if (typeof isEnabled !== 'boolean') {
      return NextResponse.json(
        { error: 'isEnabled must be a boolean' },
        { status: 400 }
      );
    }

    // Update all BookDate configurations
    await prisma.bookDateConfig.updateMany({
      data: { isEnabled },
    });

    return NextResponse.json({
      success: true,
      isEnabled,
      message: `BookDate ${isEnabled ? 'enabled' : 'disabled'} for all users`,
    });

  } catch (error: any) {
    console.error('[BookDate] Admin toggle error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to toggle BookDate' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  return requireAuth(req, (authReq) => requireAdmin(authReq, handler));
}
