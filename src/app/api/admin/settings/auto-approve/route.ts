/**
 * Component: Admin Auto-Approve Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Admin.Settings.AutoApprove');

/**
 * GET /api/admin/settings/auto-approve
 * Get current global auto-approve setting
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const config = await prisma.configuration.findUnique({
          where: { key: 'auto_approve_requests' },
        });

        // Default to true if not configured (backward compatibility)
        const autoApproveRequests = config === null ? true : config.value === 'true';

        return NextResponse.json({ autoApproveRequests });
      } catch (error) {
        logger.error('Failed to fetch auto-approve setting', {
          error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json(
          { error: 'Failed to fetch auto-approve setting' },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * PATCH /api/admin/settings/auto-approve
 * Update global auto-approve setting
 */
export async function PATCH(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const bodyResult = await readJsonBody(request);
        if (!bodyResult.ok) return bodyResult.response;
        const body = bodyResult.data;
        const { autoApproveRequests } = body;

        // Validate input
        if (typeof autoApproveRequests !== 'boolean') {
          return NextResponse.json(
            { error: 'Invalid input. autoApproveRequests must be a boolean' },
            { status: 400 }
          );
        }

        // Update configuration
        await prisma.configuration.upsert({
          where: { key: 'auto_approve_requests' },
          create: {
            key: 'auto_approve_requests',
            value: autoApproveRequests.toString(),
          },
          update: {
            value: autoApproveRequests.toString(),
          },
        });

        logger.info(`Auto-approve setting updated to: ${autoApproveRequests}`, {
          userId: req.user?.sub,
        });

        return NextResponse.json({ autoApproveRequests });
      } catch (error) {
        logger.error('Failed to update auto-approve setting', {
          error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json(
          { error: 'Failed to update auto-approve setting' },
          { status: 500 }
        );
      }
    });
  });
}
