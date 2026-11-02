/**
 * Component: Audiobookshelf E-Reader Devices API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Lists the e-reader devices configured in Audiobookshelf, so admins can choose each user's devices
 * (Admin → Users). `sendable` is false for devices ABS won't let RMAB's token user send to.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getEreaderDevices } from '@/lib/services/audiobookshelf/ereader';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.EreaderDevices');

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        return NextResponse.json({ devices: await getEreaderDevices() });
      } catch (error) {
        logger.warn('Failed to fetch e-reader devices from Audiobookshelf', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ devices: [], error: 'Could not load e-reader devices from Audiobookshelf' });
      }
    });
  });
}
