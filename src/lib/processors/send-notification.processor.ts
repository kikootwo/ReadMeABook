/**
 * Component: Send Notification Job Processor
 * Documentation: documentation/backend/services/notifications.md
 *
 * Processes notification jobs by calling NotificationService to send alerts
 * to all enabled backends subscribed to the event.
 */

import { getNotificationService } from '../services/notification';
import { RMABLogger } from '../utils/logger';
import { refreshDiscordRequestCards } from '../services/discord/discord-runtime';
import type { SendNotificationPayload } from '../services/job-queue.service';

// Re-export for consumers that import from this module
export type { SendNotificationPayload } from '../services/job-queue.service';

/**
 * Process send notification job
 * Calls NotificationService to send notifications to all enabled backends
 */
export async function processSendNotification(payload: SendNotificationPayload): Promise<void> {
  const { event, requestId, issueId, title, author, userName, message, requestType, jobId } = payload;

  const logger = RMABLogger.forJob(jobId, 'SendNotification');

  logger.info(`Processing notification: ${event}`, { requestId: requestId || issueId });

  try {
    const notificationService = getNotificationService();
    await notificationService.sendNotification({
      event,
      requestId,
      issueId,
      title,
      author,
      userName,
      message,
      requestType,
      timestamp: new Date(),
    });

    logger.info(`Notification processed: ${event}`, { requestId });
  } catch (error) {
    logger.error('Failed to process notification', {
      event,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - non-blocking
  }

  // The request's status changed: its Discord cards follow (bot running only; background, never awaited).
  // A cancel refreshes them itself, right after the status flip
  if (event !== 'request_cancelled') refreshDiscordRequestCards(requestId);
}
