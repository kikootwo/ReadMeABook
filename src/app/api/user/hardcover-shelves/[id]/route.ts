/**
 * Component: Hardcover Shelf Delete Route
 * Documentation: documentation/backend/services/hardcover-sync.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.HardcoverShelves');

/**
 * DELETE /api/user/hardcover-shelves/[id]
 * Remove a Hardcover shelf subscription (ownership check)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { id } = await params;

      const shelf = await prisma.hardcoverShelf.findUnique({
        where: { id },
      });

      if (!shelf) {
        return NextResponse.json({ error: 'List not found' }, { status: 404 });
      }

      // Ownership check
      if (shelf.userId !== req.user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      await prisma.hardcoverShelf.delete({ where: { id } });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error('Failed to delete list', {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'Failed to delete list' },
        { status: 500 },
      );
    }
  });
}
