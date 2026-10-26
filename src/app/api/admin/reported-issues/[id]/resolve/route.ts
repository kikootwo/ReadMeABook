/**
 * Component: Admin Resolve Reported Issue API
 * Documentation: documentation/backend/services/reported-issues.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { dismissIssue, ReportedIssueError } from '@/lib/services/reported-issue.service';
import { z } from 'zod';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.ReportedIssues.Resolve');

const ResolveSchema = z.object({
  action: z.enum(['dismiss']),
});

/**
 * POST /api/admin/reported-issues/[id]/resolve
 * Dismiss a reported issue
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
        const body = await req.json();
        const { action } = ResolveSchema.parse(body);

        if (action === 'dismiss') {
          const issue = await dismissIssue(id, req.user.id);
          return NextResponse.json({ success: true, issue });
        }

        return NextResponse.json(
          { error: 'InvalidAction', message: 'Unknown action' },
          { status: 400 }
        );
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'ValidationError', details: zodIssueDetails(error) },
            { status: 400 }
          );
        }

        if (error instanceof ReportedIssueError) {
          return NextResponse.json(
            { error: 'ResolveError', message: error.message },
            { status: error.statusCode }
          );
        }

        logger.error('Failed to resolve issue', {
          error: errorForLog(error),
        });
        return NextResponse.json(
          { error: 'ServerError', message: 'Failed to resolve issue' },
          { status: 500 }
        );
      }
    });
  });
}
