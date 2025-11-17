/**
 * Component: Admin Users API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const users = await prisma.user.findMany({
          select: {
            id: true,
            plexId: true,
            plexUsername: true,
            plexEmail: true,
            role: true,
            isSetupAdmin: true,
            avatarUrl: true,
            createdAt: true,
            updatedAt: true,
            lastLoginAt: true,
            _count: {
              select: {
                requests: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        return NextResponse.json({ users });
      } catch (error) {
        console.error('[Admin] Failed to fetch users:', error);
        return NextResponse.json(
          { error: 'Failed to fetch users' },
          { status: 500 }
        );
      }
    });
  });
}
