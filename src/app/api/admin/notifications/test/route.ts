/**
 * Component: Notification Test API
 * Documentation: documentation/backend/services/notifications.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { getNotificationService, getRegisteredProviderTypes, NotificationPayload, NotificationBookMeta } from '@/lib/services/notification';
import { NOTIFICATION_EVENT_KEYS, type NotificationEvent } from '@/lib/constants/notification-events';
import { RMABLogger } from '@/lib/utils/logger';
import { z } from 'zod';
import { prisma } from '@/lib/db';

const logger = RMABLogger.create('API.Admin.Notifications.Test');

// Flexible schema: supports both backendId and type+config formats
const TestNotificationSchema = z.object({
  backendId: z.string().optional(),
  type: z.string().refine((val) => getRegisteredProviderTypes().includes(val), { message: 'Unsupported notification provider type' }).optional(),
  config: z.record(z.any()).optional(),
  // When true, send one sample notification for every event type (for easy inspection of formatting).
  allEvents: z.boolean().optional(),
});

// Sample rich metadata so test notifications reflect the real (enriched) embed format.
// Uses a real, public cover URL so the thumbnail actually renders in the test embed.
const TEST_BOOK: NotificationBookMeta = {
  coverArtUrl: 'https://m.media-amazon.com/images/I/81Nzlrfud+L.jpg',
  narrator: 'Ray Porter',
  series: null,
  seriesPart: null,
  year: 2021,
  genres: ['Science Fiction & Fantasy'],
  durationMinutes: 970,
  description:
    'Ryland Grace is the sole survivor on a desperate, last-chance mission — and if he fails, humanity and the Earth itself will perish. Except that right now, he does not know that. He cannot even remember his own name, let alone the nature of his assignment or how to complete it.',
};

/** Build a sample payload for a given event with an event-appropriate message/id. */
function buildTestPayload(event: NotificationEvent): NotificationPayload {
  const isIssue = event === 'issue_reported';
  const base: NotificationPayload = {
    event,
    requestId: 'test-request-id',
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    userName: 'Test User',
    requestType: 'audiobook',
    book: TEST_BOOK,
    timestamp: new Date(),
  };

  if (event === 'request_error') {
    base.message = 'No suitable release found after 5 attempts (test).';
  } else if (event === 'request_grabbed') {
    base.message = 'Sample.Release.M4B-GROUP via TestIndexer (qbittorrent)';
  } else if (isIssue) {
    base.issueId = 'test-issue-id';
    base.message = 'Audio cuts out near the end of chapter 3 (test).';
  }

  return base;
}

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
          // Test new config before saving
          type = parsed.type;
          encryptedConfig = notificationService.encryptConfig(type, parsed.config);
        } else {
          return NextResponse.json(
            { error: 'ValidationError', message: 'Must provide either backendId or type+config' },
            { status: 400 }
          );
        }

        // When allEvents is set, fire one sample per event type so the admin can inspect every
        // notification's formatting at once. Otherwise send a single request_available sample.
        const events: NotificationEvent[] = parsed.allEvents
          ? [...NOTIFICATION_EVENT_KEYS]
          : ['request_available'];

        // Send test notification(s) synchronously (not via job queue). Sequential to keep a
        // predictable order and stay well under Discord's webhook rate limit.
        let succeeded = 0;
        let firstError: string | null = null;
        for (const event of events) {
          try {
            await notificationService.sendToBackend(type, encryptedConfig, buildTestPayload(event));
            succeeded++;
          } catch (notificationError) {
            const errMsg = notificationError instanceof Error ? notificationError.message : String(notificationError);
            if (!firstError) firstError = errMsg;
            logger.error(`Test notification failed for ${type} (${event})`, {
              error: errMsg,
              adminId: req.user?.sub,
            });
          }
        }

        if (succeeded === 0) {
          return NextResponse.json(
            {
              error: 'NotificationError',
              message: firstError ?? 'Failed to send test notification',
            },
            { status: 400 }
          );
        }

        logger.info(`Test notification sent successfully for ${type}`, {
          adminId: req.user?.sub,
          events: succeeded,
          total: events.length,
        });

        const message =
          events.length === 1
            ? 'Test notification sent successfully'
            : `Sent ${succeeded} of ${events.length} test notifications` +
              (firstError ? ` (some failed: ${firstError})` : '');

        return NextResponse.json({ success: true, message });
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
