/**
 * Notification Provider Interface
 * Documentation: documentation/backend/services/notifications.md
 */

import type { CredentialKind } from '@/lib/utils/saved-credential';

// Re-export event types from central source of truth
export type { NotificationEvent } from '@/lib/constants/notification-events';

/** Placeholder sent to the UI instead of a saved sensitive value (and sent back to keep it) */
export const MASKED_CONFIG_VALUE = '••••••••';

// Backend type — string-based, registry is the runtime source of truth
export type NotificationBackendType = string;

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
  timestamp: Date;
}

// Provider config field definition for dynamic UI rendering
export interface ProviderConfigField {
  name: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'number';
  required: boolean;
  placeholder?: string;
  /** Short help line shown under the field */
  helpText?: string;
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

  /**
   * Config field holding the server URL the sensitive fields are sent to. A saved
   * (masked) secret is kept on update only while this URL is unchanged.
   */
  secretBoundUrl?: { field: string; defaultUrl?: string; credentialKind: CredentialKind };

  /** Self-describing metadata for UI and validation */
  metadata: ProviderMetadata;

  /**
   * Normalise a config submitted by the admin (save or test) before masked values are
   * merged and secrets encrypted, e.g. move credentials out of a URL. Returns an error
   * message to refuse the config.
   */
  normalizeSubmittedConfig?(config: Record<string, any>): { ok: true; config: Record<string, any> } | { ok: false; error: string };

  /**
   * Migrated form of a stored config, or null when it is already current. `password` is
   * a plaintext secret lifted out of the config for the caller to encrypt (or mask).
   */
  liftStoredSecrets?(config: Record<string, any>): { config: Record<string, any>; password: string | null; passwordField: string } | null;

  /** Send notification with already-decrypted config */
  send(config: Record<string, any>, payload: NotificationPayload): Promise<void>;
}
