/**
 * Component: Configuration API Routes (by category)
 * Documentation: documentation/backend/services/config.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getConfigService } from '@/lib/services/config.service';

// GET /api/config/:category - Get all config for a category
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  try {
    // TODO: Add authentication middleware - admin only
    const { category } = await params;
    const configService = getConfigService();

    const config = await configService.getCategory(category);

    return NextResponse.json({
      category,
      config,
    });
  } catch (error) {
    console.error(`Failed to get config for category:`, error);
    return NextResponse.json(
      {
        error: 'Failed to get configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
