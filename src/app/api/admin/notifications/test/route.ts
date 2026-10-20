/**
 * Component: Notification Test API
 * Documentation: documentation/backend/services/notifications.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getNotificationService, getRegisteredProviderTypes, NotificationPayload } from '@/lib/services/notification';
import { RMABLogger } from '@/lib/utils/logger';
import { z } from 'zod';
import { prisma } from '@/lib/db';

const logger = RMABLogger.create('API.Admin.Notifications.Test');

// Flexible schema: supports both backendId and type+config formats
const TestNotificationSchema = z.object({
  backendId: z.string().optional(),
  type: z.string().refine((val) => getRegisteredProviderTypes().includes(val), { message: 'Unsupported notification provider type' }).optional(),
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
        const parsed = TestNotificationSchema.parse(body);

        let type: string;
        let encryptedConfig: any;

        const notificationService = getNotificationService();

        if (parsed.backendId) {
          // Test existing backend by ID (uses stored config)
          const backend = await prisma.notificationBackend.findUnique({
            where: { id: parsed.backendId },
          });

          if (!backend) {
            return NextResponse.json(
              { error: 'NotFound', message: 'Backend not found' },
              { status: 404 }
            );
          }

          type = backend.type;
          encryptedConfig = backend.config; // Already encrypted in DB
        } else if (parsed.type && parsed.config) {
          // Test new config before saving. Prepared like a save: credentials moved out of the
          // URL, and every supplied secret encrypted as text, so a value that looks like our
          // ciphertext is never decrypted and sent to the given server
          type = parsed.type;
          const prepared = notificationService.prepareSubmittedConfig(type, parsed.config);
          if (!prepared.ok) {
            return NextResponse.json({ error: 'ValidationError', message: prepared.error }, { status: 400 });
          }
          encryptedConfig = prepared.config;
        } else {
          return NextResponse.json(
            { error: 'ValidationError', message: 'Must provide either backendId or type+config' },
            { status: 400 }
          );
        }

        // Create test payload
        const testPayload: NotificationPayload = {
          event: 'request_available',
          requestId: 'test-request-id',
          title: "The Hitchhiker's Guide to the Galaxy",
          author: 'Douglas Adams',
          userName: 'Test User',
          requestType: 'audiobook',
          timestamp: new Date(),
        };

        // Send test notification synchronously (not via job queue)
        try {
          // Call sendToBackend directly
          await notificationService.sendToBackend(type, encryptedConfig, testPayload);

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
