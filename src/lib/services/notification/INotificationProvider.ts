/**
 * Notification Provider Interface
 * Documentation: documentation/backend/services/notifications.md
 */

// Re-export event types from central source of truth
export type { NotificationEvent } from '@/lib/constants/notification-events';

// Backend type — string-based, registry is the runtime source of truth
export type NotificationBackendType = string;

// Rich book metadata for visually enhanced notifications (e.g. Discord embeds).
// Sourced from the DB (Audiobook + AudibleCache) — never requires the Discord bot.
export interface NotificationBookMeta {
  coverArtUrl?: string | null;
  narrator?: string | null;
  series?: string | null;
  seriesPart?: string | null;
  year?: number | null;
  genres?: string[] | null;
  durationMinutes?: number | null;
  description?: string | null;
}

// Notification payload
export interface NotificationPayload {
  event: import('@/lib/constants/notification-events').NotificationEvent;
  requestId?: string;
  issueId?: string;
  title: string;
  author: string;
  userName: string;
  message?: string; // For error/issue events
  requestType?: string; // 'audiobook' | 'ebook' — drives type-specific titles via getEventTitle()
  book?: NotificationBookMeta; // Optional rich metadata for embed-capable providers
  timestamp: Date;
}

// Provider config field definition for dynamic UI rendering
export interface ProviderConfigField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'number';
  required: boolean;
  placeholder?: string;
  defaultValue?: string | number;
  options?: { label: string; value: string | number }[];
}

// Provider metadata for self-describing providers
export interface ProviderMetadata {
  type: string;
  displayName: string;
  description: string;
  iconLabel: string;
  iconColor: string;
  configFields: ProviderConfigField[];
}

export interface INotificationProvider {
  /** Provider identifier */
  type: string;

  /** Config field names that need encryption/masking */
  sensitiveFields: string[];

  /** Self-describing metadata for UI and validation */
  metadata: ProviderMetadata;

  /** Send notification with already-decrypted config */
  send(config: Record<string, any>, payload: NotificationPayload): Promise<void>;
}
