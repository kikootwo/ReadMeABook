import { NextResponse } from 'next/server';
import { getSchedulerService } from '@/lib/services/scheduler.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('SchedulerRestartApi');

export async function POST() {
  try {
    logger.info('Restarting background scheduler via API request...');
    const schedulerService = getSchedulerService();
    await schedulerService.start();

    return NextResponse.json({
      success: true,
      message: 'Background scheduler restarted and re-initialized successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to restart background scheduler', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to restart background scheduler' },
      { status: 500 }
    );
  }
}
