import { NextRequest, NextResponse } from 'next/server';
import { getSchedulerService } from '@/lib/services/scheduler.service';
import { verifyAccessToken } from '@/lib/utils/jwt';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('AdminSchedulerTriggerApi');

export async function POST(request: NextRequest) {
  try {
    // 🔒 Enforce Admin Authentication
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ success: false, error: 'Unauthorized - Bearer token required' }, { status: 401 });
    }

    const payload = verifyAccessToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const { id, type } = body;

    const schedulerService = getSchedulerService();
    const jobs = await schedulerService.getScheduledJobs();

    let targetJob = null;
    if (id) {
      targetJob = jobs.find(j => j.id === id);
    } else if (type) {
      targetJob = jobs.find(j => j.type === type);
    }

    if (!targetJob) {
      return NextResponse.json(
        { success: false, error: 'Scheduled job not found by ID or type' },
        { status: 404 }
      );
    }

    const bullJobId = await schedulerService.triggerJobNow(targetJob.id);

    return NextResponse.json({
      success: true,
      message: `Job "${targetJob.name}" triggered successfully by admin ${payload.username || payload.sub}`,
      jobId: targetJob.id,
      bullJobId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to trigger scheduled job', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to trigger job' },
      { status: 500 }
    );
  }
}
