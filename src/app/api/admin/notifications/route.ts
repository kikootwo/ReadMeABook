/**
 * Component: Notification Backend API
 * Documentation: documentation/backend/services/notifications.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getNotificationService, getRegisteredProviderTypes } from '@/lib/services/notification';
import { NOTIFICATION_EVENT_KEYS } from '@/lib/constants/notification-events';
import { RMABLogger } from '@/lib/utils/logger';
import { z } from 'zod';

const logger = RMABLogger.create('API.Admin.Notifications');

const CreateBackendSchema = z.object({
  type: z.string().refine((val) => getRegisteredProviderTypes().includes(val), { message: 'Unsupported notification provider type' }),
  name: z.string().min(1),
  config: z.record(z.any()),
  events: z.array(z.enum(NOTIFICATION_EVENT_KEYS)).min(1),
  enabled: z.boolean().default(true),
});

/**
 * GET /api/admin/notifications
 * List all notification backends (sensitive values masked)
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const backends = await prisma.notificationBackend.findMany({
          orderBy: { createdAt: 'desc' },
        });

        const notificationService = getNotificationService();

        // Mask sensitive config values
        const maskedBackends = backends.map((backend) => ({
          ...backend,
          config: notificationService.maskConfig(backend.type, backend.config),
        }));

        return NextResponse.json({
          success: true,
          backends: maskedBackends,
        });
      } catch (error) {
        logger.error('Failed to fetch notification backends', {
          error: error instanceof Error ? error.message : String(error),
        });

        return NextResponse.json(
          {
            error: 'FetchError',
            message: 'Failed to fetch notification backends',
          },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * POST /api/admin/notifications
 * Create new notification backend
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();
        const { type, name, config, events, enabled } = CreateBackendSchema.parse(body);

        const notificationService = getNotificationService();

        // Normalise (e.g. credentials out of a server URL) and encrypt sensitive values
        const prepared = notificationService.prepareSubmittedConfig(type, config);
        if (!prepared.ok) {
          return NextResponse.json({ error: 'ValidationError', message: prepared.error }, { status: 400 });
        }
        const encryptedConfig = prepared.config;

        // Create backend
        const backend = await prisma.notificationBackend.create({
          data: {
            type,
            name,
            config: encryptedConfig,
            events,
            enabled,
          },
        });

        logger.info(`Created notification backend: ${name} (${type})`, {
          backendId: backend.id,
          adminId: req.user?.sub,
        });

        // Return with masked values
        return NextResponse.json({
          success: true,
          backend: {
            ...backend,
            config: notificationService.maskConfig(type, backend.config),
          },
        }, { status: 201 });
      } catch (error) {
        logger.error('Failed to create notification backend', {
          error: error instanceof Error ? error.message : String(error),
        });

        if (error instanceof z.ZodError) {
          return NextResponse.json(
            {
              error: 'ValidationError',
              details: error.errors,
            },
            { status: 400 }
          );
        }

        return NextResponse.json(
          {
            error: 'CreateError',
            message: 'Failed to create notification backend',
          },
          { status: 500 }
        );
      }
    });
  });
}
