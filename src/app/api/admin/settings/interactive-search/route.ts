/**
 * Component: Admin Interactive Search Settings API
 * Documentation: documentation/settings-pages.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.Admin.Settings.InteractiveSearch');

const CONFIG_KEY = 'interactive_search_access';

/**
 * GET /api/admin/settings/interactive-search
 * Get current global interactive search access setting
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const config = await prisma.configuration.findUnique({
          where: { key: CONFIG_KEY },
        });

        // Default to true if not configured (backward compatibility)
        const interactiveSearchAccess = config === null ? true : config.value === 'true';

        return NextResponse.json({ interactiveSearchAccess });
      } catch (error) {
        logger.error('Failed to fetch interactive search setting', {
          error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json(
          { error: 'Failed to fetch interactive search setting' },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * PATCH /api/admin/settings/interactive-search
 * Update global interactive search access setting
 */
export async function PATCH(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const bodyResult = await readJsonBody(request);
        if (!bodyResult.ok) return bodyResult.response;
        const body = bodyResult.data;
        const { interactiveSearchAccess } = body;

        // Validate input
        if (typeof interactiveSearchAccess !== 'boolean') {
          return NextResponse.json(
            { error: 'Invalid input. interactiveSearchAccess must be a boolean' },
            { status: 400 }
          );
        }

        // Update configuration
        await prisma.configuration.upsert({
          where: { key: CONFIG_KEY },
          create: {
            key: CONFIG_KEY,
            value: interactiveSearchAccess.toString(),
          },
          update: {
            value: interactiveSearchAccess.toString(),
          },
        });

        logger.info(`Interactive search access setting updated to: ${interactiveSearchAccess}`, {
          userId: req.user?.sub,
        });

        return NextResponse.json({ interactiveSearchAccess });
      } catch (error) {
        logger.error('Failed to update interactive search setting', {
          error: error instanceof Error ? error.message : String(error)
        });
        return NextResponse.json(
          { error: 'Failed to update interactive search setting' },
          { status: 500 }
        );
      }
    });
  });
}
