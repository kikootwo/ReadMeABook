import { NextResponse } from 'next/server';
import { getSchedulerService } from '@/lib/services/scheduler.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('SchedulerStatusApi');

export async function GET() {
  try {
    const schedulerService = getSchedulerService();
    const jobs = await schedulerService.getScheduledJobs();

    const status = jobs.map(job => ({
      id: job.id,
      name: job.name,
      type: job.type,
      schedule: job.schedule,
      enabled: job.enabled,
      lastRun: job.lastRun,
      lastRunJobId: job.lastRunJobId,
      updatedAt: job.updatedAt,
    }));

    return NextResponse.json({
      success: true,
      count: status.length,
      jobs: status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to fetch scheduler status', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to fetch scheduler status' },
      { status: 500 }
    );
  }
}
