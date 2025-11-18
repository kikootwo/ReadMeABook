/**
 * Component: Latest Setup Jobs API
 * Documentation: documentation/backend/services/jobs.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/utils/jwt';
import { prisma } from '@/lib/db';

/**
 * GET /api/admin/jobs/latest-setup
 * Get the most recent audible_refresh and plex_library_scan jobs
 */
export async function GET(request: NextRequest) {
  try {
    // Verify admin auth
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyAccessToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    console.log('[LatestSetupJobs] Fetching latest setup jobs');

    // Get the most recent audible_refresh job
    const audibleJob = await prisma.job.findFirst({
      where: { type: 'audible_refresh' },
      orderBy: { createdAt: 'desc' },
    });

    // Get the most recent plex_library_scan job
    const plexJob = await prisma.job.findFirst({
      where: { type: 'plex_library_scan' },
      orderBy: { createdAt: 'desc' },
    });

    console.log(`[LatestSetupJobs] Found audible job: ${audibleJob?.id}, plex job: ${plexJob?.id}`);

    return NextResponse.json({
      success: true,
      jobs: {
        audible_refresh: audibleJob ? {
          id: audibleJob.id,
          status: audibleJob.status,
          createdAt: audibleJob.createdAt,
          startedAt: audibleJob.startedAt,
          completedAt: audibleJob.completedAt,
        } : null,
        plex_library_scan: plexJob ? {
          id: plexJob.id,
          status: plexJob.status,
          createdAt: plexJob.createdAt,
          startedAt: plexJob.startedAt,
          completedAt: plexJob.completedAt,
        } : null,
      },
    });
  } catch (error) {
    console.error('[LatestSetupJobs] Failed to fetch jobs:', error);
    return NextResponse.json(
      {
        error: 'InternalError',
        message: error instanceof Error ? error.message : 'Failed to fetch jobs',
      },
      { status: 500 }
    );
  }
}
