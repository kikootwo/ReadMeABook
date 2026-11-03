/**
 * Component: Send Notification Job Processor
 * Documentation: documentation/backend/services/notifications.md
 *
 * Processes notification jobs by calling NotificationService to send alerts
 * to all enabled backends subscribed to the event.
 */

import { getNotificationService } from '../services/notification';
import { enrichBookMeta } from '../services/notification/notification-enrichment';
import { getDiscordBotService } from '../services/discord/discord-bot.service';
import { RMABLogger } from '../utils/logger';
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

    // Best-effort rich metadata (cover, narrator, series, genres, duration) for embed-capable
    // backends. DB-only — independent of the Discord bot. Never blocks the notification.
    const book = await enrichBookMeta(requestId);

    await notificationService.sendNotification({
      event,
      requestId,
      issueId,
      title,
      author,
      userName,
      message,
      requestType,
      book,
      timestamp: new Date(),
    });

    logger.info(`Notification processed: ${event}`, { requestId });

    // Refresh any live Discord request card to the request's new status. Gated on the bot actually
    // running so discord.js stays unloaded when the bot is disabled (dynamic import below).
    if (requestId && getDiscordBotService().getClient()) {
      try {
        const { editRequestCards } = await import('../services/discord/discord-cards');
        await editRequestCards(requestId);
      } catch (error) {
        logger.warn('Failed to update Discord request card', {
          requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.error('Failed to process notification', {
      event,
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - non-blocking
  }
}
