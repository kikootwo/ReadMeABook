/**
 * Component: Apprise Notification Provider
 * Documentation: documentation/backend/services/notifications.md
 */

import { INotificationProvider, NotificationPayload, ProviderMetadata } from '../INotificationProvider';
import { getEventMeta, getEventTitle, type NotificationSeverity } from '@/lib/constants/notification-events';
import { liftAppriseUrlCredentials, normalizeAppriseConfig, splitUrlCredentials } from './apprise-credentials';

export interface AppriseConfig {
  serverUrl: string;
  basicAuthUser?: string;
  basicAuthPassword?: string;
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
  sensitiveFields = ['urls', 'authToken', 'basicAuthPassword'];
  secretBoundUrl = { field: 'serverUrl', credentialKind: 'apprise' as const };
  metadata: ProviderMetadata = {
    type: 'apprise',
    displayName: 'Apprise',
    description: 'Send notifications via Apprise API to 100+ services',
    iconLabel: 'A',
    iconColor: 'bg-purple-500',
    configFields: [
      { name: 'serverUrl', label: 'Server URL', type: 'text', required: true, placeholder: 'http://apprise:8000', helpText: 'Without credentials; use the Basic Auth fields below.' },
      { name: 'basicAuthUser', label: 'Basic Auth Username', type: 'text', required: false },
      { name: 'basicAuthPassword', label: 'Basic Auth Password', type: 'password', required: false, helpText: 'Not used when an Auth Token is set (the token takes precedence).' },
      { name: 'urls', label: 'Notification URLs', type: 'password', required: false, placeholder: 'slack://token, discord://webhook_id/token, ...' },
      { name: 'configKey', label: 'Config Key', type: 'text', required: false, placeholder: 'Persistent configuration key' },
      { name: 'tag', label: 'Tag', type: 'text', required: false, placeholder: 'Filter tag for stateful config' },
      { name: 'authToken', label: 'Auth Token', type: 'password', required: false, placeholder: 'Optional API auth token' },
    ],
  };

  normalizeSubmittedConfig(config: Record<string, any>) {
    return normalizeAppriseConfig(config);
  }

  liftStoredSecrets(config: Record<string, any>) {
    const lifted = liftAppriseUrlCredentials(config);
    return lifted ? { ...lifted, passwordField: 'basicAuthPassword' } : null;
  }

  async send(config: Record<string, any>, payload: NotificationPayload): Promise<void> {
    const appriseConfig = config as unknown as AppriseConfig;
    const meta = getEventMeta(payload.event);
    const { title, body } = this.formatMessage(payload);

    // Validate first: URL/fetch errors echo their input, which could include credentials
    const split = splitUrlCredentials(String(appriseConfig.serverUrl ?? ''));
    if (!split) {
      throw new Error('The Apprise Server URL is not a valid URL');
    }
    const serverUrl = split.url.replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Basic auth: userinfo still inside a not-yet-migrated URL wins over the fields, part by
    // part, exactly as the startup migration and maskConfig lift it, so a send before the
    // migration uses the same credentials that are stored after it. The request URL never
    // carries userinfo.
    const user = split.user || appriseConfig.basicAuthUser || '';
    const password = split.password || appriseConfig.basicAuthPassword || '';
    if (user || password) {
      headers['Authorization'] = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    }

    const notificationType = SEVERITY_TYPES[meta.severity];

    // An auth token (Bearer) takes precedence over Basic auth
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
      body: messageLines.join('\n'),
    };
  }
}
