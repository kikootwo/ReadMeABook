/**
 * Component: Audiobookshelf E-Reader Devices API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Lists the e-reader devices configured in Audiobookshelf so admins can enroll devices
 * per user (Admin → Users). Admin token sees all devices.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getEreaderDevices } from '@/lib/services/audiobookshelf/api';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.EreaderDevices');

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const devices = await getEreaderDevices();
        return NextResponse.json({
          devices: devices.map((d) => ({ name: d.name, email: d.email })),
        });
      } catch (error) {
        // Not configured / unreachable — return empty list so the UI degrades gracefully
        logger.warn('Failed to fetch e-reader devices from Audiobookshelf', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ devices: [] });
      }
    });
  });
}
