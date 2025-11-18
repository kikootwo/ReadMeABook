/**
 * Component: Admin Job Execution Status API
 * Documentation: documentation/backend/services/jobs.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/lib/utils/jwt';
import { getJobQueueService } from '@/lib/services/job-queue.service';

/**
 * GET /api/admin/job-status/:id
 * Get job execution status by database job ID
 */
export async function GET(
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

    console.log(`[JobStatus] Fetching status for job ID: ${id}`);

    const jobQueueService = getJobQueueService();
    const job = await jobQueueService.getJob(id);

    if (!job) {
      console.log(`[JobStatus] Job not found: ${id}`);
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    console.log(`[JobStatus] Job ${id} status: ${job.status}, type: ${job.type}`);

    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        result: job.result,
        errorMessage: job.errorMessage,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
      },
    });
  } catch (error) {
    console.error('Failed to get job status:', error);
    return NextResponse.json(
      {
        error: 'InternalError',
        message: error instanceof Error ? error.message : 'Failed to get job status',
      },
      { status: 500 }
    );
  }
}
