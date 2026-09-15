/**
 * Component: Admin Request Approval API
 * Documentation: documentation/admin-features/request-approval.md
 *
 * Thin HTTP wrapper around processRequestApproval() (src/lib/services/request-approval.service.ts).
 * The shared service is also used by the Discord bot's Approve/Deny buttons so both surfaces run
 * an identical approval code path.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { processRequestApproval } from '@/lib/services/request-approval.service';
import { RMABLogger } from '@/lib/utils/logger';
import { z } from 'zod';

const logger = RMABLogger.create('API.Admin.Requests.Approve');

const ApprovalActionSchema = z.object({
  action: z.enum(['approve', 'deny']),
  selectedTorrent: z.any().optional(),
});

/**
 * POST /api/admin/requests/[id]/approve
 * Approve or deny a request in 'awaiting_approval' status
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        if (!req.user) {
          return NextResponse.json(
            { error: 'Unauthorized', message: 'User not authenticated' },
            { status: 401 }
          );
        }

        const { id } = await params;
        const body = await request.json();

        // Validate action and optional admin-selected torrent
        const { action, selectedTorrent: adminSelectedTorrent } = ApprovalActionSchema.parse(body);

        const result = await processRequestApproval({
          requestId: id,
          action,
          adminUserId: req.user.sub,
          selectedTorrent: adminSelectedTorrent,
        });

        if (!result.success) {
          // Map service reason → HTTP status
          if (result.reason === 'not_found') {
            return NextResponse.json(
              { error: 'NotFound', message: result.message },
              { status: 404 }
            );
          }
          if (result.reason === 'invalid_status') {
            return NextResponse.json(
              {
                error: 'InvalidStatus',
                message: result.message,
                currentStatus: result.currentStatus,
              },
              { status: 400 }
            );
          }
          return NextResponse.json(
            { error: 'ApprovalError', message: result.message },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          message: result.message,
          request: result.request,
        });
      } catch (error) {
        logger.error('Failed to process approval action', {
          error: error instanceof Error ? error.message : String(error)
        });

        if (error instanceof z.ZodError) {
          return NextResponse.json(
            {
              error: 'ValidationError',
              message: 'Invalid action. Must be "approve" or "deny"',
              details: error.errors,
            },
            { status: 400 }
          );
        }

        return NextResponse.json(
          {
            error: 'ApprovalError',
            message: 'Failed to process approval action',
          },
          { status: 500 }
        );
      }
    });
  });
}
