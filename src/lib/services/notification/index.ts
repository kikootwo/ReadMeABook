/**
 * Notification Service - Public API
 * Documentation: documentation/backend/services/notifications.md
 */

// Interface + shared types
export type {
  INotificationProvider,
  NotificationEvent,
  NotificationBackendType,
  NotificationPayload,
  NotificationBookMeta,
  ProviderConfigField,
  ProviderMetadata,
} from './INotificationProvider';

// Centralized event constants (re-exported for convenience)
export {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_KEYS,
  EVENT_LABELS,
  getEventMeta,
  getEventLabel,
} from '@/lib/constants/notification-events';
export type { NotificationSeverity, NotificationPriority, NotificationEventMeta } from '@/lib/constants/notification-events';

// Core service
export {
  NotificationService,
  getNotificationService,
  registerProvider,
  getProvider,
  getRegisteredProviderTypes,
  getAllProviderMetadata,
} from './notification.service';

// Provider types
export type { AppriseConfig } from './providers/apprise.provider';
export type { DiscordConfig } from './providers/discord.provider';
export type { NtfyConfig } from './providers/ntfy.provider';
export type { PushoverConfig } from './providers/pushover.provider';

// Provider classes
export { AppriseProvider } from './providers/apprise.provider';
export { DiscordProvider } from './providers/discord.provider';
export { NtfyProvider } from './providers/ntfy.provider';
export { PushoverProvider } from './providers/pushover.provider';
