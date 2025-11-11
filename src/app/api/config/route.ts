/**
 * Component: Configuration API Routes
 * Documentation: documentation/backend/services/config.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getConfigService, ConfigUpdate } from '@/lib/services/config.service';
import { z } from 'zod';

const ConfigUpdateSchema = z.object({
  updates: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      encrypted: z.boolean().optional(),
      category: z.string().optional(),
      description: z.string().optional(),
    })
  ),
});

// PUT /api/config - Update multiple configuration values
export async function PUT(request: NextRequest) {
  try {
    // TODO: Add authentication middleware - admin only

    const body = await request.json();
    const { updates } = ConfigUpdateSchema.parse(body);

    const configService = getConfigService();
    await configService.setMany(updates as ConfigUpdate[]);

    return NextResponse.json({
      success: true,
      updated: updates.length,
    });
  } catch (error) {
    console.error('Failed to update configuration:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation error',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to update configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// GET /api/config - Get all configuration (masked sensitive values)
export async function GET() {
  try {
    // TODO: Add authentication middleware - admin only

    const configService = getConfigService();
    const allConfig = await configService.getAll();

    return NextResponse.json({
      config: allConfig,
    });
  } catch (error) {
    console.error('Failed to get all configuration:', error);
    return NextResponse.json(
      {
        error: 'Failed to get configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
