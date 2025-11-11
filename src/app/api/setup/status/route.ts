/**
 * Component: Setup Status API Route
 * Documentation: documentation/backend/api.md
 */

import { NextResponse } from 'next/server';
import { getConfigService } from '@/lib/services/config.service';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const configService = getConfigService();

    // Check if setup is completed
    const setupCompleted = await configService.isSetupCompleted();

    // Check if any users exist
    const userCount = await prisma.user.count();
    const hasUsers = userCount > 0;

    return NextResponse.json({
      setupCompleted,
      hasUsers,
    });
  } catch (error) {
    console.error('Failed to get setup status:', error);
    return NextResponse.json(
      {
        error: 'Failed to get setup status',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
