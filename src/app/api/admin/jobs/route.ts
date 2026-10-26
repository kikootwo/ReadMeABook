/**
 * Component: Admin Jobs Management API
 * Documentation: documentation/backend/services/scheduler.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/utils/jwt';
import { getSchedulerService } from '@/lib/services/scheduler.service';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Admin.Jobs');

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
    logger.error('Failed to get scheduled jobs', { error: error instanceof Error ? error.message : String(error) });
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

    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const body = bodyResult.data;
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
    logger.error('Failed to create scheduled job', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        error: 'InternalError',
        message: error instanceof Error ? error.message : 'Failed to create scheduled job',
      },
      { status: 500 }
    );
  }
}
