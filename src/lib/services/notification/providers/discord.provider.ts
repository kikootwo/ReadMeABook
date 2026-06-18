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

  // ── Embed formatting helpers (kept local; the bot's equivalents in
  //    services/discord/embeds.ts pull in discord.js, which must never load here) ──

  /** Reduce a comma-separated person list to just the top-listed name. */
  private firstPerson(value?: string | null): string {
    if (!value) return '';
    const first = value.split(',')[0]?.trim();
    return first || value.trim();
  }

  /** Format a runtime in minutes as e.g. "12h 34m" / "45m". */
  private formatDuration(minutes?: number | null): string | null {
    if (!minutes || minutes <= 0) return null;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  }

  /** Strip HTML tags and truncate (Discord descriptions cap at 4096; we keep it short). */
  private cleanDescription(value?: string | null, max = 300): string | null {
    if (!value) return null;
    const text = value.replace(/<[^>]*>/g, '').trim();
    if (!text) return null;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  private truncate(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }

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
    const { event, title, author, userName, message, requestId, requestType, book, timestamp } = payload;
    const meta = getEventMeta(event);
    const resolvedTitle = getEventTitle(event, requestType);

    const isIssue = event === 'issue_reported';
    const isEbook = requestType === 'ebook';

    // Fold the release year into the book title in parentheses, mirroring the bot's request card.
    const bookTitle = book?.year ? `${title} (${book.year})` : title;

    const fields: { name: string; value: string; inline: boolean }[] = [
      { name: 'Title', value: this.truncate(bookTitle, 256), inline: false },
      { name: 'Author', value: this.truncate(this.firstPerson(author) || author, 256), inline: true },
    ];

    // Narrator + duration are audiobook-only concepts (omitted for ebooks).
    if (!isEbook && book?.narrator) {
      fields.push({ name: 'Narrator', value: this.truncate(this.firstPerson(book.narrator), 256), inline: true });
    }
    if (!isEbook) {
      const duration = this.formatDuration(book?.durationMinutes);
      if (duration) fields.push({ name: 'Duration', value: duration, inline: true });
    }
    if (book?.series) {
      const series = book.seriesPart ? `${book.series} #${book.seriesPart}` : book.series;
      fields.push({ name: 'Series', value: this.truncate(series, 256), inline: true });
    }
    if (book?.genres && book.genres.length > 0) {
      fields.push({ name: 'Genre', value: this.truncate(book.genres.slice(0, 2).join(', '), 256), inline: true });
    }

    fields.push({ name: isIssue ? 'Reported By' : 'Requested By', value: userName, inline: true });

    if (message) {
      fields.push({ name: meta.messageLabel ?? 'Error', value: this.truncate(message, 1024), inline: false });
    }

    const embed: any = {
      title: `${meta.emoji} ${resolvedTitle}`,
      color: SEVERITY_COLORS[meta.severity],
      fields,
      footer: {
        text: isIssue ? `Issue ID: ${payload.issueId}` : `Request ID: ${requestId}`,
      },
      timestamp: timestamp.toISOString(),
    };

    const description = this.cleanDescription(book?.description);
    if (description) embed.description = description;
    if (book?.coverArtUrl) embed.thumbnail = { url: book.coverArtUrl };

    return embed;
  }
}
