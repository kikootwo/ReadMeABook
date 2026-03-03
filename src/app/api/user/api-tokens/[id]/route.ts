/**
 * Component: User API Token Delete Route (self-service)
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { checkApiTokenRevokeRateLimit } from '@/lib/utils/apiTokenRateLimit';

const logger = RMABLogger.create('API.User.ApiTokens');

/**
 * DELETE /api/user/api-tokens/[id]
 * Revoke (delete) one of the current user's own API tokens
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      const rateLimit = checkApiTokenRevokeRateLimit(req.user!.id);
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: 'Too many API token revoke attempts. Please try again later.' },
          {
            status: 429,
            headers: {
              'Retry-After': String(rateLimit.retryAfterSeconds),
            },
          }
        );
      }

      const { id } = await params;

      const token = await prisma.apiToken.findUnique({ where: { id } });
      if (!token) {
        return NextResponse.json({ error: 'Token not found' }, { status: 404 });
      }

      // Only allow deleting own tokens
      if (token.userId !== req.user!.id) {
        return NextResponse.json({ error: 'Token not found' }, { status: 404 });
      }

      await prisma.apiToken.delete({ where: { id } });

      logger.info('User API token revoked', { tokenId: id, name: token.name, userId: req.user!.id });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Failed to revoke user API token', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json({ error: 'Failed to revoke API token' }, { status: 500 });
    }
  });
}
