import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSchedulerService } from '@/lib/services/scheduler.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('MetricsApi');

export async function GET() {
  try {
    let metricsLines: string[] = [];

    // 1. Fetch DB Request breakdown
    try {
      const requestGroup = await prisma.request.groupBy({
        by: ['status'],
        _count: {
          _all: true,
        },
        where: {
          deletedAt: null,
        },
      });

      metricsLines.push('# HELP rmab_requests_total Total requests by status');
      metricsLines.push('# TYPE rmab_requests_total gauge');
      if (Array.isArray(requestGroup)) {
        requestGroup.forEach(g => {
          metricsLines.push(`rmab_requests_total{status="${g.status}"} ${g._count?._all || 0}`);
        });
      }
    } catch (dbErr) {
      logger.warn('Metrics: Could not fetch request breakdown', { error: dbErr instanceof Error ? dbErr.message : String(dbErr) });
    }

    // 2. Fetch Scheduled Jobs freshness
    try {
      const schedulerService = getSchedulerService();
      const jobs = await schedulerService.getScheduledJobs();

      metricsLines.push('# HELP rmab_scheduled_job_last_run_timestamp_seconds Last run timestamp of scheduled job in seconds');
      metricsLines.push('# TYPE rmab_scheduled_job_last_run_timestamp_seconds gauge');
      if (Array.isArray(jobs)) {
        jobs.forEach(j => {
          const ts = j.lastRun ? Math.floor(new Date(j.lastRun).getTime() / 1000) : 0;
          metricsLines.push(`rmab_scheduled_job_last_run_timestamp_seconds{job="${j.type}",enabled="${j.enabled}"} ${ts}`);
        });
      }
    } catch (schedErr) {
      logger.warn('Metrics: Could not fetch scheduled jobs', { error: schedErr instanceof Error ? schedErr.message : String(schedErr) });
    }

    const output = metricsLines.join('\n') + '\n';

    return new NextResponse(output, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      },
    });
  } catch (error) {
    logger.error('Failed to generate Prometheus metrics', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse('Internal Server Error generating metrics', { status: 500 });
  }
}
