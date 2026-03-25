/**
 * Component: Pushover Notification Provider
 * Documentation: documentation/backend/services/notifications.md
 */

import { INotificationProvider, NotificationPayload, ProviderMetadata } from '../INotificationProvider';
import { getEventMeta, getEventTitle, type NotificationPriority } from '@/lib/constants/notification-events';

export interface PushoverConfig {
  userKey: string;
  appToken: string;
  device?: string;
  priority?: number;
}

// Pushover priorities by notification priority (Normal=0, High=1)
const PRIORITY_MAP: Record<NotificationPriority, number> = {
  normal: 0,
  high: 1,
};

export class PushoverProvider implements INotificationProvider {
  type = 'pushover' as const;
  sensitiveFields = ['userKey', 'appToken'];
  metadata: ProviderMetadata = {
    type: 'pushover',
    displayName: 'Pushover',
    description: 'Send notifications via Pushover API',
    iconLabel: 'P',
    iconColor: 'bg-blue-500',
    configFields: [
      { name: 'userKey', label: 'User Key', type: 'text', required: true, placeholder: 'Your Pushover user key' },
      { name: 'appToken', label: 'App Token', type: 'text', required: true, placeholder: 'Your Pushover app token' },
      { name: 'device', label: 'Device', type: 'text', required: false, placeholder: 'Optional device name' },
      {
        name: 'priority', label: 'Priority', type: 'select', required: false, defaultValue: 0,
        options: [
          { label: 'Lowest', value: -2 },
          { label: 'Low', value: -1 },
          { label: 'Normal', value: 0 },
          { label: 'High', value: 1 },
          { label: 'Emergency', value: 2 },
        ],
      },
    ],
  };

  async send(config: Record<string, any>, payload: NotificationPayload): Promise<void> {
    const pushoverConfig = config as unknown as PushoverConfig;
    const meta = getEventMeta(payload.event);
    const { title, message } = this.formatMessage(payload);

    const body = new URLSearchParams({
      token: pushoverConfig.appToken,
      user: pushoverConfig.userKey,
      title,
      message,
      priority: String(pushoverConfig.priority ?? PRIORITY_MAP[meta.priority]),
      ...(pushoverConfig.device && { device: pushoverConfig.device }),
    });

    const response = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Pushover API failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    if (result.status !== 1) {
      throw new Error(`Pushover API error: ${JSON.stringify(result.errors || 'Unknown error')}`);
    }
  }

  private formatMessage(payload: NotificationPayload): { title: string; message: string } {
    const { event, title, author, userName, message, requestType } = payload;
    const meta = getEventMeta(event);
    const resolvedTitle = getEventTitle(event, requestType);

    const isIssue = event === 'issue_reported';
    const messageLines = [
      `${meta.emoji} ${resolvedTitle}`,
      '',
      `\u{1F4DA} ${title}`,
      `\u270D\uFE0F ${author}`,
      `\u{1F464} ${isIssue ? 'Reported by' : 'Requested by'}: ${userName}`,
    ];

    if (message) {
      const messageLabel = meta.messageLabel ?? 'Error';
      const msgEmoji = meta.severity === 'error' ? '\u26A0\uFE0F' : '\u{1F4DD}';
      messageLines.push('', `${msgEmoji} ${messageLabel}: ${message}`);
    }

    return {
      title: resolvedTitle,
      message: messageLines.join('\n'),
    };
  }
}
