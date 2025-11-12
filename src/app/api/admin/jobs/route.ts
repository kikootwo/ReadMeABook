/**
 * Component: Admin Jobs Management API
 * Documentation: documentation/backend/services/scheduler.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/utils/jwt';
import { getSchedulerService } from '@/lib/services/scheduler.service';

/**
 * GET /api/admin/jobs
 * Get all scheduled jobs
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

    const schedulerService = getSchedulerService();
    const jobs = await schedulerService.getScheduledJobs();

    return NextResponse.json({
      jobs,
    });
  } catch (error) {
    console.error('Failed to get scheduled jobs:', error);
    return NextResponse.json(
      {
        error: 'InternalError',
        message: 'Failed to retrieve scheduled jobs',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/jobs
 * Create a new scheduled job
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const schedulerService = getSchedulerService();

    const job = await schedulerService.createScheduledJob({
      name: body.name,
      type: body.type,
      schedule: body.schedule,
      enabled: body.enabled,
      payload: body.payload,
    });

    return NextResponse.json({
      job,
    });
  } catch (error) {
    console.error('Failed to create scheduled job:', error);
    return NextResponse.json(
      {
        error: 'InternalError',
        message: error instanceof Error ? error.message : 'Failed to create scheduled job',
      },
      { status: 500 }
    );
  }
}
