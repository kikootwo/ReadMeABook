/**
 * Component: Notification Event Constants
 * Documentation: documentation/backend/services/notifications.md
 *
 * Single source of truth for all notification event types and metadata.
 * Add new events here — all providers, API schemas, and UI labels derive from this.
 */

export type NotificationSeverity = 'info' | 'success' | 'error' | 'warning';
export type NotificationPriority = 'normal' | 'high';

/**
 * Central registry of notification events.
 *
 * Each entry defines:
 * - `label`:              Human-readable name shown in the UI
 * - `title`:              Default title used in notification messages
 * - `titleByRequestType`: Optional map of request-type-specific titles (e.g. audiobook → "Audiobook Available")
 * - `emoji`:              Emoji prefix for notification titles
 * - `severity`:           Drives provider formatting (colors, Apprise types, ntfy tags)
 * - `priority`:           Drives notification urgency (Pushover/ntfy priority levels)
 * - `messageLabel`:       Optional label for the `message` payload field (defaults to "Error" if omitted)
 */
export const NOTIFICATION_EVENTS = {
  request_pending_approval: {
    label: 'Request Pending Approval',
    title: 'New Request Pending Approval',
    emoji: '\u{1F4EC}',
    severity: 'info' as const,
    priority: 'normal' as const,
  },
  request_approved: {
    label: 'Request Approved',
    title: 'Request Approved',
    emoji: '\u2705',
    severity: 'success' as const,
    priority: 'normal' as const,
  },
  request_grabbed: {
    label: 'Request Grabbed',
    title: 'Download Grabbed',
    titleByRequestType: {
      audiobook: 'Audiobook Grabbed',
      ebook: 'Ebook Grabbed',
    } as Record<string, string>,
    emoji: '\u{1F4E5}',
    severity: 'info' as const,
    priority: 'normal' as const,
    messageLabel: 'Details',
  },
  request_available: {
    label: 'Request Available',
    title: 'Request Available',
    titleByRequestType: {
      audiobook: 'Audiobook Available',
      ebook: 'Ebook Available',
    } as Record<string, string>,
    emoji: '\u{1F389}',
    severity: 'success' as const,
    priority: 'high' as const,
  },
  request_error: {
    label: 'Request Error',
    title: 'Request Error',
    emoji: '\u274C',
    severity: 'error' as const,
    priority: 'high' as const,
  },
  issue_reported: {
    label: 'Issue Reported',
    title: 'Issue Reported',
    emoji: '\u{1F6A9}',
    severity: 'warning' as const,
    priority: 'high' as const,
    messageLabel: 'Reason',
  },
} as const;

/** Union type of all valid notification event keys */
export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

/** Ordered array of all notification event keys (for Zod schemas, iteration) */
export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as [NotificationEvent, ...NotificationEvent[]];

/** Metadata shape for a single notification event */
export type NotificationEventMeta = (typeof NOTIFICATION_EVENTS)[NotificationEvent];

/**
 * Normalized interface for event metadata consumed by providers.
 * Broadens the `as const` literal union to make optional fields accessible.
 */
export interface NotificationEventConfig {
  label: string;
  title: string;
  titleByRequestType?: Record<string, string>;
  emoji: string;
  severity: NotificationSeverity;
  priority: NotificationPriority;
  /** Label for the `message` payload field. Defaults to "Error" in providers when absent. */
  messageLabel?: string;
}

/** Helper: get event metadata by key */
export function getEventMeta(event: NotificationEvent): NotificationEventConfig {
  return NOTIFICATION_EVENTS[event] as NotificationEventConfig;
}

/**
 * Helper: get the resolved notification title for an event.
 * If the event has a `titleByRequestType` map and a matching requestType is provided,
 * returns the type-specific title. Otherwise falls back to the default `title`.
 */
export function getEventTitle(event: NotificationEvent, requestType?: string): string {
  const meta = NOTIFICATION_EVENTS[event];
  if (requestType && 'titleByRequestType' in meta) {
    const typeTitle = (meta as typeof meta & { titleByRequestType: Record<string, string> }).titleByRequestType[requestType];
    if (typeTitle) return typeTitle;
  }
  return meta.title;
}

/** Helper: get the human-readable label for an event */
export function getEventLabel(event: NotificationEvent): string {
  return NOTIFICATION_EVENTS[event].label;
}

/** Record mapping all event keys to their labels (for UI dropdowns, etc.) */
export const EVENT_LABELS: Record<NotificationEvent, string> = Object.fromEntries(
  Object.entries(NOTIFICATION_EVENTS).map(([key, meta]) => [key, meta.label])
) as Record<NotificationEvent, string>;
