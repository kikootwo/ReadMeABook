/**
 * Component: Admin Metrics API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        // Get system metrics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalRequests,
      activeDownloads,
      completedLast30Days,
      failedLast30Days,
      totalUsers,
    ] = await Promise.all([
      // Total requests (all time)
      prisma.request.count(),

      // Active downloads (downloading status)
      prisma.request.count({
        where: {
          status: 'downloading',
        },
      }),

      // Completed requests (last 30 days) - 'downloaded' and 'available' statuses
      prisma.request.count({
        where: {
          status: {
            in: ['downloaded', 'available'],
          },
          completedAt: {
            gte: thirtyDaysAgo,
          },
        },
      }),

      // Failed requests (last 30 days)
      prisma.request.count({
        where: {
          status: 'failed',
          updatedAt: {
            gte: thirtyDaysAgo,
          },
        },
      }),

      // Total users
      prisma.user.count(),
    ]);

    // Check system health
    const systemHealth = await checkSystemHealth();

    return NextResponse.json({
      totalRequests,
      activeDownloads,
      completedLast30Days,
      failedLast30Days,
      totalUsers,
      systemHealth,
    });
      } catch (error) {
        console.error('[Admin] Failed to fetch metrics:', error);
        return NextResponse.json(
          { error: 'Failed to fetch metrics' },
          { status: 500 }
        );
      }
    });
  });
}

async function checkSystemHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
}> {
  const issues: string[] = [];

  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    issues.push('Database connection failed');
  }

  // Check for stale downloads (downloading for more than 24 hours)
  const oneDayAgo = new Date();
  oneDayAgo.setHours(oneDayAgo.getHours() - 24);

  const staleDownloads = await prisma.request.count({
    where: {
      status: 'downloading',
      updatedAt: {
        lt: oneDayAgo,
      },
    },
  });

  if (staleDownloads > 0) {
    issues.push(`${staleDownloads} stale downloads (>24h)`);
  }

  // Determine overall status
  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (issues.length > 0) {
    status = issues.some((i) => i.includes('Database')) ? 'unhealthy' : 'degraded';
  }

  return { status, issues };
}
