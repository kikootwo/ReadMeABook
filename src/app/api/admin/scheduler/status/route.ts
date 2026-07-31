import { NextRequest, NextResponse } from 'next/server';
import { getSchedulerService } from '@/lib/services/scheduler.service';
import { verifyAccessToken } from '@/lib/utils/jwt';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('AdminSchedulerStatusApi');

export async function GET(request: NextRequest) {
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

    const schedulerService = getSchedulerService();
    const jobs = await schedulerService.getScheduledJobs();

    return NextResponse.json({
      success: true,
      jobs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to fetch scheduler status', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch scheduler status' },
      { status: 500 }
    );
  }
}
