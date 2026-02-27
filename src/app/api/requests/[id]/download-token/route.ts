/**
 * Component: On-Demand Download Token Generator
 * Documentation: documentation/backend/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { generateDownloadToken } from '@/lib/utils/jwt';
import { COMPLETED_STATUSES } from '@/lib/constants/request-statuses';
import { resolveDownloadAccess } from '@/lib/utils/permissions';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.DownloadToken');

/**
 * POST /api/requests/[id]/download-token
 * Generate a signed download token on demand (lazy token generation).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      // Check download permission
      const userRecord = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { role: true, downloadAccess: true },
      });
      const hasDownloadAccess = await resolveDownloadAccess(
        userRecord?.role ?? 'user',
        userRecord?.downloadAccess ?? null
      );
      if (!hasDownloadAccess) {
        return NextResponse.json(
          { error: 'Forbidden', message: 'You do not have download access' },
          { status: 403 }
        );
      }

      const { id } = await params;

      const requestRecord = await prisma.request.findFirst({
        where: { id, deletedAt: null },
        include: { audiobook: true },
      });

      if (!requestRecord) {
        return NextResponse.json(
          { error: 'NotFound', message: 'Request not found' },
          { status: 404 }
        );
      }

      if (!COMPLETED_STATUSES.includes(requestRecord.status as typeof COMPLETED_STATUSES[number])) {
        return NextResponse.json(
          { error: 'BadRequest', message: 'Request is not yet completed' },
          { status: 400 }
        );
      }

      if (!requestRecord.audiobook?.filePath) {
        return NextResponse.json(
          { error: 'NotFound', message: 'No file available for this request' },
          { status: 404 }
        );
      }

      const token = generateDownloadToken(req.user.id, id);
      const downloadUrl = `/api/requests/${id}/download?token=${token}`;

      return NextResponse.json({ downloadUrl });
    } catch (error) {
      logger.error('Failed to generate download token', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: 'TokenError', message: 'Failed to generate download token' },
        { status: 500 }
      );
    }
  });
}
