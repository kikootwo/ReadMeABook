/**
 * Component: Admin Request Management API
 * Documentation: documentation/admin-features/request-deletion.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { deleteRequest } from '@/lib/services/request-delete.service';

/**
 * DELETE /api/admin/requests/[id]
 * Soft delete a request with intelligent cleanup (admin only)
 *
 * This endpoint:
 * 1. Validates admin authorization
 * 2. Soft deletes the request (sets deletedAt timestamp)
 * 3. Deletes media files from the title folder
 * 4. Handles torrents based on seeding configuration:
 *    - Unlimited seeding (0): Keeps torrent, stops monitoring
 *    - Seeding complete: Deletes torrent + files
 *    - Still seeding: Keeps torrent for cleanup job
 * 5. Allows re-requesting the same audiobook after deletion
 */
export async function DELETE(
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

        // Perform soft delete with cleanup
        const result = await deleteRequest(id, req.user.id);

        if (!result.success) {
          return NextResponse.json(
            {
              error: result.error || 'DeleteFailed',
              message: result.message,
            },
            { status: result.error === 'NotFound' ? 404 : 500 }
          );
        }

        // Return detailed result
        return NextResponse.json({
          success: true,
          message: result.message,
          details: {
            filesDeleted: result.filesDeleted,
            torrentsRemoved: result.torrentsRemoved,
            torrentsKeptSeeding: result.torrentsKeptSeeding,
            torrentsKeptUnlimited: result.torrentsKeptUnlimited,
          },
        });
      } catch (error) {
        console.error('[Admin] Failed to delete request:', error);
        return NextResponse.json(
          {
            error: 'DeleteError',
            message: 'Failed to delete request',
            details: error instanceof Error ? error.message : 'Unknown error',
          },
          { status: 500 }
        );
      }
    });
  });
}
