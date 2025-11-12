/**
 * Component: Initialization API Route
 * Documentation: documentation/backend/services/scheduler.md
 *
 * This route is called during server startup to initialize the scheduler
 * and trigger any overdue jobs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSchedulerService } from '@/lib/services/scheduler.service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    console.log('[Init] Initializing application services...');

    // Initialize scheduler service
    const schedulerService = getSchedulerService();
    await schedulerService.start();

    console.log('[Init] Application services initialized successfully');

    return NextResponse.json({
      success: true,
      message: 'Application services initialized',
    });
  } catch (error) {
    console.error('[Init] Failed to initialize services:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to initialize services',
      },
      { status: 500 }
    );
  }
}
