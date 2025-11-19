/**
 * Component: Admin Job Trigger API
 * Documentation: documentation/backend/services/scheduler.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/utils/jwt';
import { getSchedulerService } from '@/lib/services/scheduler.service';

/**
 * POST /api/admin/jobs/:id/trigger
 * Manually trigger a scheduled job
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    // Await params in Next.js 15+
    const { id } = await params;

    console.log(`[JobTrigger] Triggering scheduled job: ${id}`);

    const schedulerService = getSchedulerService();
    const jobId = await schedulerService.triggerJobNow(id);

    console.log(`[JobTrigger] Job triggered successfully, database job ID: ${jobId}`);

    return NextResponse.json({
      success: true,
      jobId,
      message: 'Job triggered successfully',
    });
  } catch (error) {
    console.error('Failed to trigger job:', error);
    return NextResponse.json(
      {
        error: 'InternalError',
        message: error instanceof Error ? error.message : 'Failed to trigger job',
      },
      { status: 500 }
    );
  }
}
