/**
 * Pending Users API
 * Documentation: documentation/features/audiobookshelf-integration.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const pendingUsers = await prisma.user.findMany({
          where: {
            registrationStatus: 'pending_approval'
          },
          select: {
            id: true,
            plexUsername: true,
            plexEmail: true,
            authProvider: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        return NextResponse.json({ users: pendingUsers });
      } catch (error) {
        console.error('[Admin] Failed to fetch pending users:', error);
        return NextResponse.json(
          { error: 'Failed to fetch pending users' },
          { status: 500 }
        );
      }
    });
  });
}
