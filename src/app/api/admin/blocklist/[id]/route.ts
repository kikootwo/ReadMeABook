/**
 * Component: Admin Blocklist — Single Unblock
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * DELETE /api/admin/blocklist/[id] → removes a single blocklist entry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { Prisma } from '@/generated/prisma';
import { RMABLogger } from '@/lib/utils/logger';
import { removeBlock } from '@/lib/services/blocklist.service';

const logger = RMABLogger.create('API.Admin.Blocklist.Unblock');

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      const { id } = await params;
      if (!id || typeof id !== 'string' || id.trim().length === 0) {
        return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
      }

      try {
        await removeBlock(id);
        return NextResponse.json({ success: true });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          return NextResponse.json(
            { error: 'NotFound', message: 'Blocklist entry not found' },
            { status: 404 }
          );
        }
        logger.error('Failed to remove blocklist entry', {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: 'Failed to remove blocklist entry' },
          { status: 500 }
        );
      }
    });
  });
}
