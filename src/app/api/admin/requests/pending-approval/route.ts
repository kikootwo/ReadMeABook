/**
 * Component: Admin Pending Approval Requests API
 * Documentation: documentation/admin-features/request-approval.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Requests.PendingApproval');

/**
 * GET /api/admin/requests/pending-approval
 * Get all requests with status 'awaiting_approval'
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const requests = await prisma.request.findMany({
          where: {
            status: 'awaiting_approval',
            deletedAt: null,
          },
          include: {
            audiobook: true,
            user: {
              select: {
                id: true,
                plexUsername: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json({
          success: true,
          requests,
          count: requests.length,
        });
      } catch (error) {
        logger.error('Failed to fetch pending approval requests', {
          error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json(
          {
            error: 'FetchError',
            message: 'Failed to fetch pending approval requests',
          },
          { status: 500 }
        );
      }
    });
  });
}
