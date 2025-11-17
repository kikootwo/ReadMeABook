/**
 * Component: Admin Logs API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '100');
        const status = searchParams.get('status') || 'all';
        const type = searchParams.get('type') || 'all';

        const skip = (page - 1) * limit;

        // Build where clause
        const where: any = {};
        if (status !== 'all') {
          where.status = status;
        }
        if (type !== 'all') {
          where.type = type;
        }

        const [logs, totalCount] = await Promise.all([
          prisma.job.findMany({
            where,
            select: {
              id: true,
              bullJobId: true,
              type: true,
              status: true,
              priority: true,
              attempts: true,
              maxAttempts: true,
              errorMessage: true,
              startedAt: true,
              completedAt: true,
              createdAt: true,
              updatedAt: true,
              result: true,
              events: {
                select: {
                  id: true,
                  level: true,
                  context: true,
                  message: true,
                  metadata: true,
                  createdAt: true,
                },
                orderBy: {
                  createdAt: 'asc',
                },
              },
              request: {
                select: {
                  id: true,
                  audiobook: {
                    select: {
                      title: true,
                      author: true,
                    },
                  },
                  user: {
                    select: {
                      plexUsername: true,
                    },
                  },
                },
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
            skip,
            take: limit,
          }),
          prisma.job.count({ where }),
        ]);

        return NextResponse.json({
          logs,
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit),
          },
        });
      } catch (error) {
        console.error('[Admin] Failed to fetch logs:', error);
        return NextResponse.json(
          { error: 'Failed to fetch logs' },
          { status: 500 }
        );
      }
    });
  });
}
