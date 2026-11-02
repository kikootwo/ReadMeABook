/**
 * Component: Report Issue API
 * Documentation: documentation/backend/services/reported-issues.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { reportIssue, ReportedIssueError } from '@/lib/services/reported-issue.service';
import { z } from 'zod';
import { errorForLog, zodIssueDetails } from '@/lib/utils/zod-validation';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.ReportIssue');

const ReportIssueSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(250, 'Reason must be 250 characters or less'),
  title: z.string().optional(),
  author: z.string().optional(),
  coverArtUrl: z.string().optional(),
});

/**
 * POST /api/audiobooks/[asin]/report-issue
 * Report an issue with an available audiobook
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const { asin } = await params;
      const bodyResult = await readJsonBody(req);
      if (!bodyResult.ok) return bodyResult.response;
      const body = bodyResult.data;
      const { reason, title, author, coverArtUrl } = ReportIssueSchema.parse(body);

      const issue = await reportIssue(asin, req.user.id, reason, { title, author, coverArtUrl });

      return NextResponse.json({ success: true, issue }, { status: 201 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'ValidationError', details: zodIssueDetails(error) },
          { status: 400 }
        );
      }

      if (error instanceof ReportedIssueError) {
        return NextResponse.json(
          { error: 'ReportIssueError', message: error.message },
          { status: error.statusCode }
        );
      }

      logger.error('Failed to report issue', {
        error: errorForLog(error),
      });
      return NextResponse.json(
        { error: 'ServerError', message: 'Failed to report issue' },
        { status: 500 }
      );
    }
  });
}
