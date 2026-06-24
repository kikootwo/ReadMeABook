/**
 * Component: E-book Destination Path Reachability Check API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Verifies that a custom ebook destination path is reachable AND writable by
 * the RMAB container's filesystem, so admins get immediate feedback instead of
 * silent fallback to the default media dir at organize time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { checkPathReachable } from '@/lib/utils/path-reachability';
import { RMABLogger } from '@/lib/utils/logger';

export const runtime = 'nodejs';

const logger = RMABLogger.create('API.Admin.Settings.Ebook.CheckPath');

export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { path } = await request.json();

        if (!path || typeof path !== 'string' || !path.trim()) {
          return NextResponse.json(
            { reachable: false, message: 'No path provided.' },
            { status: 400 }
          );
        }

        // Shared with the organizer's destination resolver so admin feedback and
        // the organize-time fallback agree on what "reachable" means.
        const result = await checkPathReachable(path);
        return NextResponse.json(result);
      } catch (error) {
        logger.error('Ebook path check failed', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { reachable: false, message: error instanceof Error ? error.message : 'Unknown error' },
          { status: 500 }
        );
      }
    });
  });
}
