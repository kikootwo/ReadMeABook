/**
 * Component: Audiobook Download Status API Route
 * Documentation: documentation/backend/api.md
 *
 * Returns whether a downloadable file exists for this audiobook (by ASIN).
 * Used by AudiobookDetailsModal to show the download link regardless of context.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { COMPLETED_STATUSES } from '@/lib/constants/request-statuses';
import { resolveDownloadAccess } from '@/lib/utils/permissions';

/**
 * GET /api/audiobooks/[asin]/download-status
 * Returns { downloadAvailable, requestId } for the current user's completed request.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    if (!req.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check download permission - if denied, don't reveal file existence
    const userRecord = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, downloadAccess: true },
    });
    const hasDownloadAccess = await resolveDownloadAccess(
      userRecord?.role ?? 'user',
      userRecord?.downloadAccess ?? null
    );
    if (!hasDownloadAccess) {
      return NextResponse.json({ downloadAvailable: false, requestId: null });
    }

    const { asin } = await params;

    const audiobook = await prisma.audiobook.findFirst({
      where: { audibleAsin: asin },
      select: { id: true, filePath: true },
    });

    if (!audiobook) {
      return NextResponse.json({ downloadAvailable: false, requestId: null });
    }

    // Find any completed request for this audiobook that has a file
    const completedRequest = await prisma.request.findFirst({
      where: {
        audiobookId: audiobook.id,
        status: { in: [...COMPLETED_STATUSES] },
        deletedAt: null,
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    const downloadAvailable = !!completedRequest && !!audiobook.filePath;

    return NextResponse.json({
      downloadAvailable,
      requestId: downloadAvailable ? completedRequest!.id : null,
    });
  });
}
