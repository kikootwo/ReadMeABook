/**
 * Component: Notification Backend Individual API
 * Documentation: documentation/backend/services/notifications.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getNotificationService } from '@/lib/services/notification';
import { NOTIFICATION_EVENT_KEYS } from '@/lib/constants/notification-events';
import { RMABLogger } from '@/lib/utils/logger';
import { z } from 'zod';

const logger = RMABLogger.create('API.Admin.Notifications.Id');

const UpdateBackendSchema = z.object({
  name: z.string().min(1).optional(),
  config: z.record(z.any()).optional(),
  events: z.array(z.enum(NOTIFICATION_EVENT_KEYS)).min(1).optional(),
  enabled: z.boolean().optional(),
});

/**
 * GET /api/admin/notifications/[id]
 * Get single notification backend (sensitive values masked)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;

        const backend = await prisma.notificationBackend.findUnique({
          where: { id },
        });

        if (!backend) {
          return NextResponse.json(
            { error: 'NotFound', message: 'Notification backend not found' },
            { status: 404 }
          );
        }

        const notificationService = getNotificationService();

        // Mask sensitive config values
        return NextResponse.json({
          success: true,
          backend: {
            ...backend,
            config: notificationService.maskConfig(backend.type, backend.config),
          },
        });
      } catch (error) {
        logger.error('Failed to fetch notification backend', {
          error: error instanceof Error ? error.message : String(error),
        });

        return NextResponse.json(
          {
            error: 'FetchError',
            message: 'Failed to fetch notification backend',
          },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * PUT /api/admin/notifications/[id]
 * Update notification backend
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;
        const body = await request.json();
        const updates = UpdateBackendSchema.parse(body);

        // Get existing backend
        const existing = await prisma.notificationBackend.findUnique({
          where: { id },
        });

        if (!existing) {
          return NextResponse.json(
            { error: 'NotFound', message: 'Notification backend not found' },
            { status: 404 }
          );
        }

        const notificationService = getNotificationService();

        // Handle config updates: masked values keep the saved (encrypted) value, but only
        // while the server URL those secrets belong to is unchanged; new values are encrypted
        let finalConfig = existing.config;
        if (updates.config) {
          const merge = notificationService.mergeMaskedSecrets(existing.type, existing.config, updates.config);
          if (!merge.ok) {
            return NextResponse.json({ error: 'ValidationError', message: merge.error }, { status: 400 });
          }
          finalConfig = notificationService.encryptConfig(existing.type, merge.config);
        }

        // Update backend
        const updateData: any = {};
        if (updates.name) updateData.name = updates.name;
        if (updates.config) updateData.config = finalConfig;
        if (updates.events) updateData.events = updates.events;
        if (updates.enabled !== undefined) updateData.enabled = updates.enabled;

        const updated = await prisma.notificationBackend.update({
          where: { id },
          data: updateData,
        });

        logger.info(`Updated notification backend: ${updated.name}`, {
          backendId: id,
          adminId: req.user?.sub,
        });

        // Return with masked values
        return NextResponse.json({
          success: true,
          backend: {
            ...updated,
            config: notificationService.maskConfig(updated.type, updated.config),
          },
        });
      } catch (error) {
        logger.error('Failed to update notification backend', {
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
            error: 'UpdateError',
            message: 'Failed to update notification backend',
          },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * DELETE /api/admin/notifications/[id]
 * Delete notification backend
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id } = await params;

        // Check if backend exists
        const backend = await prisma.notificationBackend.findUnique({
          where: { id },
        });

        if (!backend) {
          return NextResponse.json(
            { error: 'NotFound', message: 'Notification backend not found' },
            { status: 404 }
          );
        }

        // Delete backend
        await prisma.notificationBackend.delete({
          where: { id },
        });

        logger.info(`Deleted notification backend: ${backend.name}`, {
          backendId: id,
          adminId: req.user?.sub,
        });

        return NextResponse.json({
          success: true,
          message: 'Notification backend deleted',
        });
      } catch (error) {
        logger.error('Failed to delete notification backend', {
          error: error instanceof Error ? error.message : String(error),
        });

        return NextResponse.json(
          {
            error: 'DeleteError',
            message: 'Failed to delete notification backend',
          },
          { status: 500 }
        );
      }
    });
  });
}
