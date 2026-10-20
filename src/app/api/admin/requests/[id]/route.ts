/**
 * Component: Admin Request Management API
 * Documentation: documentation/admin-features/request-deletion.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { deleteRequest } from '@/lib/services/request-delete.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Requests');

/**
 * DELETE /api/admin/requests/[id]
 * Soft delete a request with intelligent cleanup (admin only)
 *
 * This endpoint:
 * 1. Validates admin authorization
 * 2. Soft deletes the request (sets deletedAt timestamp)
 * 3. Deletes media files from the title folder
 * 4. Handles torrents based on seeding configuration:
 *    - Seeding time and ratio limit both 0: keeps torrent, stops monitoring
 *    - Every set limit met (or download incomplete): deletes torrent + files,
 *      unless another active request still uses it
 *    - Still seeding: keeps torrent for the cleanup job
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
            torrentsKeptShared: result.torrentsKeptShared,
          },
        });
      } catch (error) {
        logger.error('Failed to delete request', { error: error instanceof Error ? error.message : String(error) });
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
