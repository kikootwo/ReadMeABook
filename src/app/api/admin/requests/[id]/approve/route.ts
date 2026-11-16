/**
 * Component: Admin Request Approval API
 * Documentation: documentation/admin-features/request-approval.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { rejectedSelectionResponse, selectionFailureResponse } from '@/lib/services/download-selection-guard';
import { approvalMessage, decideRequestApproval } from '@/lib/services/request-approval.service';
import { keptClaimStatus } from '@/lib/services/request-approval-start';
import {
  approvalOutcome,
  auditTokenApproval,
  isTokenCaller,
  thrownApprovalOutcome,
  tokenApprovalRefusal,
  type TokenApprovalOutcome,
} from '@/lib/services/api-token-approval';
import { RMABLogger } from '@/lib/utils/logger';
import { z } from 'zod';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Admin.Requests.Approve');

const ApprovalActionSchema = z.object({
  action: z.enum(['approve', 'deny']),
  selectedTorrent: z.any().optional(),
});

/**
 * POST /api/admin/requests/[id]/approve
 * Approve or deny a request in 'awaiting_approval' status (shared approval service).
 * An API token caller (opt-in, see api-token-approval.ts) may only approve, with no release in
 * the body; each token decision or refusal writes one warn audit line.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      const tokenCaller = isTokenCaller(req);
      let requestId: string | undefined;
      let bodyUnreadable = false;
      const audit = (outcome: TokenApprovalOutcome, status: string | null) => {
        if (tokenCaller) auditTokenApproval({ requestId, outcome, status, token: req.apiToken, adminId: req.user?.sub });
      };
      try {
        if (!req.user) {
          return NextResponse.json(
            { error: 'Unauthorized', message: 'User not authenticated' },
            { status: 401 }
          );
        }

        const { id } = await params;
        requestId = id;
        const bodyResult = await readJsonBody(request).catch((error: unknown) => {
          bodyUnreadable = true;
          throw error;
        });
        if (!bodyResult.ok) {
          audit('invalid_body', null);
          return bodyResult.response;
        }
        const body = bodyResult.data;

        // Validate action and optional admin-selected torrent
        const { action, selectedTorrent } = ApprovalActionSchema.parse(body);

        // Token callers: approve only, never a named release (checked before any row is read)
        const refusal = tokenCaller ? tokenApprovalRefusal({ action, selectedTorrent }) : null;
        if (refusal) {
          audit(refusal.reason === 'deny' ? 'refused_deny' : 'refused_release', null);
          return NextResponse.json({ error: refusal.error, message: refusal.message }, { status: refusal.status });
        }

        const result = await decideRequestApproval({
          requestId: id,
          action,
          adminId: req.user.sub,
          adminSelectedTorrent: tokenCaller ? undefined : selectedTorrent,
          via: tokenCaller ? 'api_token' : 'web',
        });
        if (tokenCaller) {
          const { outcome, status } = approvalOutcome(result);
          audit(outcome, status);
        }

        if (!result.ok) {
          switch (result.code) {
            case 'not_found':
              return NextResponse.json(
                { error: 'NotFound', message: 'Request not found' },
                { status: 404 }
              );
            case 'invalid_status':
              return NextResponse.json(
                {
                  error: 'InvalidStatus',
                  message: `Request is not awaiting approval (current status: ${result.currentStatus})`,
                  currentStatus: result.currentStatus,
                },
                { status: 400 }
              );
            case 'source_unavailable':
              return selectionFailureResponse({ error: result.error, retryable: true });
            case 'pick_rejected':
              return rejectedSelectionResponse(result.message);
          }
        }

        if (result.action === 'deny') {
          return NextResponse.json({
            success: true,
            message: 'Request denied',
            request: result.request,
          });
        }

        return NextResponse.json({
          success: true,
          message: approvalMessage(result),
          ...(result.status === 'awaiting_release' ? { awaitingRelease: true } : {}),
          ...(result.droppedPickReason ? { selectionDropped: result.droppedPickReason } : {}),
          request: result.request,
        });
      } catch (error) {
        logger.error('Failed to process approval action', {
          error: errorForLog(error)
        });
        if (tokenCaller) {
          const { outcome, status } = thrownApprovalOutcome({
            invalidBody: bodyUnreadable || error instanceof z.ZodError,
            keptStatus: keptClaimStatus(error),
          });
          audit(outcome, status);
        }

        if (error instanceof z.ZodError) {
          return NextResponse.json(
            {
              error: 'ValidationError',
              message: 'Invalid action. Must be "approve" or "deny"',
              details: zodIssueDetails(error),
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
