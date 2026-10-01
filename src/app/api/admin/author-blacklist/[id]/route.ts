/**
 * Component: Admin Author Blacklist DELETE
 * Documentation: documentation/admin-features/author-blacklist.md
 *
 * DELETE /api/admin/author-blacklist/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { removeBlockedAuthor } from '@/lib/services/author-blacklist.service';

const logger = RMABLogger.create('API.Admin.AuthorBlacklist');

/**
 * DELETE /api/admin/author-blacklist/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, (req: AuthenticatedRequest) =>
    requireAdmin(req, async () => {
      try {
        const { id } = await params;
        if (!id) {
          return NextResponse.json({ error: 'Missing id' }, { status: 400 });
        }

        const removed = await removeBlockedAuthor(id);
        if (!removed) {
          return NextResponse.json({ error: 'Author not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true });
      } catch (error) {
        logger.error('Failed to remove author from blacklist', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: 'Failed to remove author from blacklist' },
          { status: 500 }
        );
      }
    })
  );
}
