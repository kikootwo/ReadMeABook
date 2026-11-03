/**
 * Component: Request Cancel API Route (API tokens and sessions)
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { cancelLoadedRequest } from '@/lib/services/request-cancel.service';
import { cancelResponse } from '@/lib/utils/cancel-response';

const logger = RMABLogger.create('API.RequestCancel');

/**
 * POST /api/requests/[id]/cancel
 * Cancel a request: the owner, or an admin (a token acts with its owner's current role)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized', message: 'User not authenticated' }, { status: 401 });
      }

      const { id } = await params;
      const record = await prisma.request.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          userId: true,
          status: true,
          audiobookId: true,
          type: true,
          audiobook: { select: { title: true, author: true } },
          user: { select: { plexUsername: true } },
        },
      });
      if (!record) {
        return NextResponse.json({ error: 'NotFound', message: 'Request not found' }, { status: 404 });
      }

      const isAdmin = req.user.role === 'admin';
      if (record.userId !== req.user.id && !isAdmin) {
        return NextResponse.json({ error: 'Forbidden', message: 'You do not have access to this request' }, { status: 403 });
      }

      return cancelResponse(await cancelLoadedRequest(record, { audience: isAdmin ? 'admin' : 'owner', actor: { userId: req.user.id } }));
    } catch (error) {
      logger.error('Failed to cancel request', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'CancelError', message: 'Failed to cancel request' }, { status: 500 });
    }
  });
}
