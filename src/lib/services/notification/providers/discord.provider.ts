/**
 * Component: Discord Notification Provider
 * Documentation: documentation/backend/services/notifications.md
 */

import { INotificationProvider, NotificationPayload, ProviderMetadata } from '../INotificationProvider';
import { getEventMeta, getEventTitle, type NotificationSeverity } from '@/lib/constants/notification-events';

export interface DiscordConfig {
  webhookUrl: string;
  username?: string;
  avatarUrl?: string;
}

// Discord embed colors by severity
const SEVERITY_COLORS: Record<NotificationSeverity, number> = {
  info: 0xfbbf24,    // yellow-400
  success: 0x22c55e, // green-500
  error: 0xef4444,   // red-500
  warning: 0xf97316, // orange-500
};

export class DiscordProvider implements INotificationProvider {
  type = 'discord' as const;
  sensitiveFields = ['webhookUrl'];
  metadata: ProviderMetadata = {
    type: 'discord',
    displayName: 'Discord',
    description: 'Send notifications via Discord webhook',
    iconLabel: 'D',
    iconColor: 'bg-indigo-500',
    configFields: [
      { name: 'webhookUrl', label: 'Webhook URL', type: 'text', required: true, placeholder: 'https://discord.com/api/webhooks/...' },
      { name: 'username', label: 'Username', type: 'text', required: false, placeholder: 'ReadMeABook', defaultValue: 'ReadMeABook' },
      { name: 'avatarUrl', label: 'Avatar URL', type: 'text', required: false, placeholder: 'https://example.com/avatar.png', defaultValue: '' },
    ],
  };

  async send(config: Record<string, any>, payload: NotificationPayload): Promise<void> {
    const discordConfig = config as unknown as DiscordConfig;
    const embed = this.formatEmbed(payload);

    const body = {
      username: discordConfig.username || 'ReadMeABook',
      avatar_url: discordConfig.avatarUrl,
      embeds: [embed],
    };

    const response = await fetch(discordConfig.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Discord webhook failed: ${response.status} ${errorText}`);
    }
  }

  private formatEmbed(payload: NotificationPayload): any {
    const { event, title, author, userName, message, requestId, requestType, timestamp } = payload;
    const meta = getEventMeta(event);
    const resolvedTitle = getEventTitle(event, requestType);

    const isIssue = event === 'issue_reported';
    const fields = [
      { name: 'Title', value: title, inline: false },
      { name: 'Author', value: author, inline: true },
      { name: isIssue ? 'Reported By' : 'Requested By', value: userName, inline: true },
    ];

    if (message) {
      fields.push({ name: meta.messageLabel ?? 'Error', value: message, inline: false });
    }

    return {
      title: `${meta.emoji} ${resolvedTitle}`,
      color: SEVERITY_COLORS[meta.severity],
      fields,
      footer: {
        text: isIssue ? `Issue ID: ${payload.issueId}` : `Request ID: ${requestId}`,
      },
      timestamp: timestamp.toISOString(),
    };
  }
}
