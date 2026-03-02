/**
 * Component: Apprise Notification Provider
 * Documentation: documentation/backend/services/notifications.md
 */

import { INotificationProvider, NotificationPayload, ProviderMetadata } from '../INotificationProvider';
import { getEventMeta, getEventTitle, type NotificationSeverity } from '@/lib/constants/notification-events';

export interface AppriseConfig {
  serverUrl: string;
  urls?: string;
  configKey?: string;
  tag?: string;
  authToken?: string;
}

// Apprise notification types by severity
const SEVERITY_TYPES: Record<NotificationSeverity, string> = {
  info: 'info',
  success: 'success',
  error: 'failure',
  warning: 'warning',
};

export class AppriseProvider implements INotificationProvider {
  type = 'apprise' as const;
  sensitiveFields = ['urls', 'authToken'];
  metadata: ProviderMetadata = {
    type: 'apprise',
    displayName: 'Apprise',
    description: 'Send notifications via Apprise API to 100+ services',
    iconLabel: 'A',
    iconColor: 'bg-purple-500',
    configFields: [
      { name: 'serverUrl', label: 'Server URL', type: 'text', required: true, placeholder: 'http://apprise:8000' },
      { name: 'urls', label: 'Notification URLs', type: 'password', required: false, placeholder: 'slack://token, discord://webhook_id/token, ...' },
      { name: 'configKey', label: 'Config Key', type: 'text', required: false, placeholder: 'Persistent configuration key' },
      { name: 'tag', label: 'Tag', type: 'text', required: false, placeholder: 'Filter tag for stateful config' },
      { name: 'authToken', label: 'Auth Token', type: 'password', required: false, placeholder: 'Optional API auth token' },
    ],
  };

  async send(config: Record<string, any>, payload: NotificationPayload): Promise<void> {
    const appriseConfig = config as unknown as AppriseConfig;
    const meta = getEventMeta(payload.event);
    const { title, body } = this.formatMessage(payload);

    // Parse URL to extract embedded HTTP Basic Auth credentials (e.g. https://user:pass@host/)
    let serverUrl: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    try {
      const parsed = new URL(appriseConfig.serverUrl);
      if (parsed.username) {
        const username = decodeURIComponent(parsed.username);
        const password = decodeURIComponent(parsed.password);
        headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
        parsed.username = '';
        parsed.password = '';
        serverUrl = parsed.toString().replace(/\/+$/, '');
      } else {
        serverUrl = appriseConfig.serverUrl.replace(/\/+$/, '');
      }
    } catch {
      serverUrl = appriseConfig.serverUrl.replace(/\/+$/, '');
    }

    const notificationType = SEVERITY_TYPES[meta.severity];

    // Explicit authToken (Bearer) takes precedence over URL-embedded credentials
    if (appriseConfig.authToken) {
      headers['Authorization'] = `Bearer ${appriseConfig.authToken}`;
    }

    // Stateful mode: use configKey endpoint
    if (appriseConfig.configKey) {
      const url = `${serverUrl}/notify/${appriseConfig.configKey}`;
      const requestBody: Record<string, string> = {
        title,
        body,
        type: notificationType,
      };

      if (appriseConfig.tag) {
        requestBody.tag = appriseConfig.tag;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Apprise API failed: ${response.status} ${errorText}`);
      }
      return;
    }

    // Stateless mode: send URLs directly
    if (!appriseConfig.urls) {
      throw new Error('Apprise requires either notification URLs or a config key');
    }

    const url = `${serverUrl}/notify/`;
    const requestBody = {
      urls: appriseConfig.urls,
      title,
      body,
      type: notificationType,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Apprise API failed: ${response.status} ${errorText}`);
    }
  }

  private formatMessage(payload: NotificationPayload): { title: string; body: string } {
    const { event, title, author, userName, message, requestType } = payload;

    const isIssue = event === 'issue_reported';
    const messageLines = [
      `\u{1F4DA} ${title}`,
      `\u270D\uFE0F ${author}`,
      `\u{1F464} ${isIssue ? 'Reported by' : 'Requested by'}: ${userName}`,
    ];

    if (message) {
      messageLines.push(isIssue ? `\u{1F4DD} Reason: ${message}` : `\u26A0\uFE0F Error: ${message}`);
    }

    return {
      title: getEventTitle(event, requestType),
      body: messageLines.join('\n'),
    };
  }
}
