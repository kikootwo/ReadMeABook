/**
 * Component: Current User Route
 * Documentation: documentation/backend/services/auth.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/auth/me
 * Get current authenticated user information
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    if (!req.user) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'User not authenticated',
        },
        { status: 401 }
      );
    }

    // Fetch full user details from database
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        plexId: true,
        plexUsername: true,
        plexEmail: true,
        role: true,
        isSetupAdmin: true,
        avatarUrl: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        {
          error: 'NotFound',
          message: 'User not found',
        },
        { status: 404 }
      );
    }

    // Determine if user is local admin (setup admin with local authentication)
    const isLocalAdmin = user.isSetupAdmin && user.plexId.startsWith('local-');

    return NextResponse.json({
      user: {
        id: user.id,
        plexId: user.plexId,
        username: user.plexUsername,
        email: user.plexEmail,
        role: user.role,
        isLocalAdmin: isLocalAdmin,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    });
  });
}
