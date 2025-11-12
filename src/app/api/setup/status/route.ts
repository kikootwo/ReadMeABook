/**
 * Component: Setup Status Check API
 * Documentation: documentation/setup-wizard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/setup/status
 * Returns whether initial setup has been completed
 * Used by middleware for routing logic
 */
export async function GET(request: NextRequest) {
  try {
    const config = await prisma.configuration.findUnique({
      where: { key: 'setup_completed' },
    });

    const setupComplete = config?.value === 'true';

    return NextResponse.json({
      setupComplete,
    });
  } catch (error) {
    // If database is not ready or table doesn't exist, setup is not complete
    console.error('[Setup Status] Check failed:', error);
    return NextResponse.json({
      setupComplete: false,
    });
  }
}
