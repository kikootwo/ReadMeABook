/**
 * Component: API Token Delete Route
 * Documentation: documentation/backend/services/api-tokens.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.ApiTokens');

/**
 * DELETE /api/admin/api-tokens/[id]
 * Revoke (delete) an API token
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, (req: AuthenticatedRequest) =>
    requireAdmin(req, async () => {
      try {
        const { id } = await params;

        const token = await prisma.apiToken.findUnique({ where: { id } });
        if (!token) {
          return NextResponse.json({ error: 'Token not found' }, { status: 404 });
        }

        await prisma.apiToken.delete({ where: { id } });

        logger.info('API token revoked', { tokenId: id, name: token.name, revokedBy: req.user!.username });

        return NextResponse.json({ success: true });
      } catch (error) {
        logger.error('Failed to revoke API token', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ error: 'Failed to revoke API token' }, { status: 500 });
      }
    })
  );
}
