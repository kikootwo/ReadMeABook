/**
 * Component: Admin Blocklist — Per-Request Lookup
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * GET /api/admin/blocklist/by-request/[requestId]
 *   → { entries: BlockedRelease[], count: number }
 *
 * Lightweight, unpaginated lookup used by:
 *   - The "N releases blocked" chip on the admin recent-requests table.
 *   - The InteractiveTorrentSearchModal "already blocked" badge.
 *
 * Per-request blocklists are bounded by indexer candidate count (~tens),
 * so no pagination is needed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { RMABLogger } from '@/lib/utils/logger';
import { getBlocklistForRequest } from '@/lib/services/blocklist.service';

const logger = RMABLogger.create('API.Admin.Blocklist.ByRequest');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      const { requestId } = await params;
      if (!requestId || typeof requestId !== 'string' || requestId.trim().length === 0) {
        return NextResponse.json({ error: 'Invalid requestId' }, { status: 400 });
      }

      try {
        const entries = await getBlocklistForRequest(requestId);
        return NextResponse.json({ entries, count: entries.length });
      } catch (error) {
        logger.error('Failed to fetch blocklist for request', {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: 'Failed to fetch blocklist for request' },
          { status: 500 }
        );
      }
    });
  });
}
