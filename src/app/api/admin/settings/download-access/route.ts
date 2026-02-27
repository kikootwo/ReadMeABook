/**
 * Component: Admin Download Access Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Settings.DownloadAccess');

const CONFIG_KEY = 'download_access';

/**
 * GET /api/admin/settings/download-access
 * Get current global download access setting
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const config = await prisma.configuration.findUnique({
          where: { key: CONFIG_KEY },
        });

        // Default to true if not configured (backward compatibility)
        const downloadAccess = config === null ? true : config.value === 'true';

        return NextResponse.json({ downloadAccess });
      } catch (error) {
        logger.error('Failed to fetch download access setting', {
          error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json(
          { error: 'Failed to fetch download access setting' },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * PATCH /api/admin/settings/download-access
 * Update global download access setting
 */
export async function PATCH(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();
        const { downloadAccess } = body;

        // Validate input
        if (typeof downloadAccess !== 'boolean') {
          return NextResponse.json(
            { error: 'Invalid input. downloadAccess must be a boolean' },
            { status: 400 }
          );
        }

        // Update configuration
        await prisma.configuration.upsert({
          where: { key: CONFIG_KEY },
          create: {
            key: CONFIG_KEY,
            value: downloadAccess.toString(),
          },
          update: {
            value: downloadAccess.toString(),
          },
        });

        logger.info(`Download access setting updated to: ${downloadAccess}`, {
          userId: req.user?.sub,
        });

        return NextResponse.json({ downloadAccess });
      } catch (error) {
        logger.error('Failed to update download access setting', {
          error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json(
          { error: 'Failed to update download access setting' },
          { status: 500 }
        );
      }
    });
  });
}
