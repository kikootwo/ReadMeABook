/**
 * Component: ntfy Notification Provider
 * Documentation: documentation/backend/services/notifications.md
 */

import { INotificationProvider, NotificationPayload, ProviderMetadata } from '../INotificationProvider';
import { getEventMeta, getEventTitle, type NotificationSeverity, type NotificationPriority } from '@/lib/constants/notification-events';

export interface NtfyConfig {
  serverUrl?: string;
  topic: string;
  accessToken?: string;
  priority?: number;
}

const DEFAULT_SERVER_URL = 'https://ntfy.sh';

// ntfy priorities by notification priority (1=min, 2=low, 3=default, 4=high, 5=urgent)
const PRIORITY_MAP: Record<NotificationPriority, number> = {
  normal: 3,
  high: 4,
};

// ntfy tags (emojis) by severity
const SEVERITY_TAGS: Record<NotificationSeverity, string[]> = {
  info: ['mailbox_with_mail'],
  success: ['white_check_mark'],
  error: ['x'],
  warning: ['triangular_flag_on_post'],
};

export class NtfyProvider implements INotificationProvider {
  type = 'ntfy' as const;
  sensitiveFields = ['accessToken'];
  metadata: ProviderMetadata = {
    type: 'ntfy',
    displayName: 'ntfy',
    description: 'Send notifications via ntfy pub/sub',
    iconLabel: 'N',
    iconColor: 'bg-teal-500',
    configFields: [
      { name: 'serverUrl', label: 'Server URL', type: 'text', required: false, placeholder: 'https://ntfy.sh', defaultValue: 'https://ntfy.sh' },
      { name: 'topic', label: 'Topic', type: 'text', required: true, placeholder: 'readmeabook' },
      { name: 'accessToken', label: 'Access Token', type: 'password', required: false, placeholder: 'tk_...' },
    ],
  };

  async send(config: Record<string, any>, payload: NotificationPayload): Promise<void> {
    const ntfyConfig = config as unknown as NtfyConfig;
    const meta = getEventMeta(payload.event);
    const { title, message } = this.formatMessage(payload);

    // ntfy JSON publishing requires POSTing to the base server URL (not the topic URL).
    // The topic is included in the JSON body. See: https://docs.ntfy.sh/publish/#publish-as-json
    const url = (ntfyConfig.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (ntfyConfig.accessToken) {
      headers['Authorization'] = `Bearer ${ntfyConfig.accessToken}`;
    }

    const body = {
      topic: ntfyConfig.topic,
      title,
      message,
      priority: ntfyConfig.priority ?? PRIORITY_MAP[meta.priority],
      tags: SEVERITY_TAGS[meta.severity],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`ntfy API failed: ${response.status} ${errorText}`);
    }
  }

  private formatMessage(payload: NotificationPayload): { title: string; message: string } {
    const { event, title, author, userName, message, requestType } = payload;
    const meta = getEventMeta(event);

    const isIssue = event === 'issue_reported';
    const messageLines = [
      `\u{1F4DA} ${title}`,
      `\u270D\uFE0F ${author}`,
      `\u{1F464} ${isIssue ? 'Reported by' : 'Requested by'}: ${userName}`,
    ];

    if (message) {
      const messageLabel = meta.messageLabel ?? 'Error';
      const msgEmoji = meta.severity === 'error' ? '\u26A0\uFE0F' : '\u{1F4DD}';
      messageLines.push(`${msgEmoji} ${messageLabel}: ${message}`);
    }

    return {
      title: getEventTitle(event, requestType),
      message: messageLines.join('\n'),
    };
  }
}
