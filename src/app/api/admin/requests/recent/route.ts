/**
 * Component: Admin Recent Requests API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        // Get recent requests
    const recentRequests = await prisma.request.findMany({
      include: {
        audiobook: {
          select: {
            id: true,
            title: true,
            author: true,
          },
        },
        user: {
          select: {
            id: true,
            plexUsername: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    // Format response
    const formatted = recentRequests.map((request) => ({
      requestId: request.id,
      title: request.audiobook.title,
      author: request.audiobook.author,
      status: request.status,
      user: request.user.plexUsername,
      createdAt: request.createdAt,
      completedAt: request.completedAt,
      errorMessage: request.errorMessage,
    }));

    return NextResponse.json({ requests: formatted });
      } catch (error) {
        console.error('[Admin] Failed to fetch recent requests:', error);
        return NextResponse.json(
          { error: 'Failed to fetch recent requests' },
          { status: 500 }
        );
      }
    });
  });
}
