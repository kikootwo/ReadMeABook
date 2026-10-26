/**
 * Component: Admin Job Update API
 * Documentation: documentation/backend/services/scheduler.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/utils/jwt';
import { getSchedulerService } from '@/lib/services/scheduler.service';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Admin.Jobs');

/**
 * PUT /api/admin/jobs/:id
 * Update a scheduled job
 */
export async function PUT(
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

    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const body = bodyResult.data;
    const schedulerService = getSchedulerService();

    const job = await schedulerService.updateScheduledJob(id, {
      name: body.name,
      schedule: body.schedule,
      enabled: body.enabled,
      payload: body.payload,
    });

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    logger.error('Failed to update scheduled job', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        error: 'InternalError',
        message: error instanceof Error ? error.message : 'Failed to update scheduled job',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/jobs/:id
 * Delete a scheduled job
 */
export async function DELETE(
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

    const schedulerService = getSchedulerService();
    await schedulerService.deleteScheduledJob(id);

    return NextResponse.json({
      success: true,
      message: 'Job deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete scheduled job', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        error: 'InternalError',
        message: error instanceof Error ? error.message : 'Failed to delete scheduled job',
      },
      { status: 500 }
    );
  }
}
