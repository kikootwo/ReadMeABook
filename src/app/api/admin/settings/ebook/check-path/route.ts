/**
 * Component: E-book Destination Path Reachability Check API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Verifies that a custom ebook destination path is reachable AND writable by
 * the RMAB container's filesystem, so admins get immediate feedback instead of
 * silent fallback to the default media dir at organize time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs, constants as fsConstants } from 'fs';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
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

        const target = path.trim();

        if (!target.startsWith('/')) {
          return NextResponse.json({
            reachable: false,
            message: 'Path must be an absolute path inside the container (start with "/").',
          });
        }

        let stats;
        try {
          stats = await fs.stat(target);
        } catch {
          return NextResponse.json({
            reachable: false,
            message: 'Path does not exist inside the container. Make sure it is mounted into the RMAB container as a volume.',
          });
        }

        if (!stats.isDirectory()) {
          return NextResponse.json({
            reachable: false,
            message: 'Path exists but is not a directory.',
          });
        }

        try {
          await fs.access(target, fsConstants.W_OK);
        } catch {
          return NextResponse.json({
            reachable: false,
            message: 'Directory is reachable but not writable by the container. Check the volume/folder permissions.',
          });
        }

        return NextResponse.json({
          reachable: true,
          message: 'Path is reachable and writable by the container.',
        });
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
