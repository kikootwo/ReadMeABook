/**
 * Component: Admin Plex Library Scan API
 * Documentation: documentation/integrations/plex.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin } from '@/lib/middleware/auth';
import { processScanPlex } from '@/lib/processors/scan-plex.processor';

/**
 * POST /api/admin/plex/scan
 * Trigger a Plex library scan to update availability status for audiobooks
 * Admin-only endpoint
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req) => {
    return requireAdmin(req, async () => {
      try {
        // Trigger scan with empty payload (will use configured library ID)
        const result = await processScanPlex({
          libraryId: undefined,
          partial: false,
        });

        return NextResponse.json({
          success: true,
          ...result,
        });
      } catch (error) {
        console.error('[API] Plex scan failed:', error);
        return NextResponse.json(
          {
            error: 'ScanFailed',
            message: error instanceof Error ? error.message : 'Failed to scan Plex library',
          },
          { status: 500 }
        );
      }
    });
  });
}
