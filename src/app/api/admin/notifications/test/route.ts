/**
 * Component: Notification Test API
 * Documentation: documentation/backend/services/notifications.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getNotificationService, NotificationBackendType, NotificationPayload } from '@/lib/services/notification.service';
import { RMABLogger } from '@/lib/utils/logger';
import { z } from 'zod';
import { prisma } from '@/lib/db';

const logger = RMABLogger.create('API.Admin.Notifications.Test');

const TestNotificationSchema = z.discriminatedUnion('mode', [
  // Test existing backend by ID (uses stored config)
  z.object({
    mode: z.literal('backend'),
    backendId: z.string(),
  }),
  // Test new config before saving
  z.object({
    mode: z.literal('config'),
    type: z.enum(['discord', 'pushover', 'email', 'slack', 'telegram', 'webhook']),
    config: z.record(z.any()),
  }),
]);

// Support legacy format without mode
const LegacyTestNotificationSchema = z.object({
  backendId: z.string().optional(),
  type: z.enum(['discord', 'pushover', 'email', 'slack', 'telegram', 'webhook']).optional(),
  config: z.record(z.any()).optional(),
});

/**
 * POST /api/admin/notifications/test
 * Test notification with provided config (synchronous)
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const body = await request.json();

        // Support legacy format for backward compatibility
        const legacyParsed = LegacyTestNotificationSchema.safeParse(body);

        let type: NotificationBackendType;
        let encryptedConfig: any;

        const notificationService = getNotificationService();

        if (legacyParsed.success) {
          // Legacy format
          if (legacyParsed.data.backendId) {
            // Test existing backend
            const backend = await prisma.notificationBackend.findUnique({
              where: { id: legacyParsed.data.backendId },
            });

            if (!backend) {
              return NextResponse.json(
                { error: 'NotFound', message: 'Backend not found' },
                { status: 404 }
              );
            }

            type = backend.type as NotificationBackendType;
            encryptedConfig = backend.config; // Already encrypted in DB
          } else if (legacyParsed.data.type && legacyParsed.data.config) {
            // Test new config
            type = legacyParsed.data.type as NotificationBackendType;
            encryptedConfig = notificationService.encryptConfig(type, legacyParsed.data.config);
          } else {
            return NextResponse.json(
              { error: 'ValidationError', message: 'Must provide either backendId or type+config' },
              { status: 400 }
            );
          }
        } else {
          // New format with discriminated union
          const parsed = TestNotificationSchema.parse(body);

          if (parsed.mode === 'backend') {
            // Test existing backend
            const backend = await prisma.notificationBackend.findUnique({
              where: { id: parsed.backendId },
            });

            if (!backend) {
              return NextResponse.json(
                { error: 'NotFound', message: 'Backend not found' },
                { status: 404 }
              );
            }

            type = backend.type as NotificationBackendType;
            encryptedConfig = backend.config; // Already encrypted in DB
          } else {
            // Test new config
            type = parsed.type;
            encryptedConfig = notificationService.encryptConfig(type, parsed.config);
          }
        }

        // Create test payload
        const testPayload: NotificationPayload = {
          event: 'request_available',
          requestId: 'test-request-id',
          title: "The Hitchhiker's Guide to the Galaxy",
          author: 'Douglas Adams',
          userName: 'Test User',
          timestamp: new Date(),
        };

        // Send test notification synchronously (not via job queue)
        try {
          // Call sendToBackend directly
          await (notificationService as any).sendToBackend(type, encryptedConfig, testPayload);

          logger.info(`Test notification sent successfully for ${type}`, {
            adminId: req.user?.sub,
          });

          return NextResponse.json({
            success: true,
            message: 'Test notification sent successfully',
          });
        } catch (notificationError) {
          logger.error(`Test notification failed for ${type}`, {
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
            adminId: req.user?.sub,
          });

          return NextResponse.json(
            {
              error: 'NotificationError',
              message: notificationError instanceof Error ? notificationError.message : 'Failed to send test notification',
            },
            { status: 400 }
          );
        }
      } catch (error) {
        logger.error('Failed to test notification', {
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
            error: 'TestError',
            message: 'Failed to test notification',
          },
          { status: 500 }
        );
      }
    });
  });
}
