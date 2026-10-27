/**
 * Component: Admin Job Execution Status API
 * Documentation: documentation/backend/services/jobs.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.JobStatus');

/**
 * GET /api/admin/job-status/:id
 * Get job execution status by database job ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        // Await params in Next.js 15+
        const { id } = await params;

        logger.debug(`Fetching status for job ID: ${id}`);

        const jobQueueService = getJobQueueService();
        const job = await jobQueueService.getJob(id);

        if (!job) {
          logger.debug(`Job not found: ${id}`);
          return NextResponse.json({ error: 'Job not found' }, { status: 404 });
        }

        logger.debug(`Job ${id} status: ${job.status}, type: ${job.type}`);

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
        logger.error('Failed to get job status', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          {
            error: 'InternalError',
            message: error instanceof Error ? error.message : 'Failed to get job status',
          },
          { status: 500 }
        );
      }
    });
  });
}
