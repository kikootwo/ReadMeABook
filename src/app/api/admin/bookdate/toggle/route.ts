/**
 * BookDate: Admin Global Toggle
 * Documentation: documentation/features/bookdate-prd.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Admin.BookDate.Toggle');

async function handler(req: AuthenticatedRequest) {
  try {
    const bodyResult = await readJsonBody(req);
    if (!bodyResult.ok) return bodyResult.response;
    const body = bodyResult.data;
    const { isEnabled } = body;

    if (typeof isEnabled !== 'boolean') {
      return NextResponse.json(
        { error: 'isEnabled must be a boolean' },
        { status: 400 }
      );
    }

    // Update all BookDate configurations
    await prisma.bookDateConfig.updateMany({
      data: { isEnabled },
    });

    return NextResponse.json({
      success: true,
      isEnabled,
      message: `BookDate ${isEnabled ? 'enabled' : 'disabled'} for all users`,
    });

  } catch (error: any) {
    logger.error('Admin toggle error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: error.message || 'Failed to toggle BookDate' },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  return requireAuth(req, (authReq) => requireAdmin(authReq, handler));
}
