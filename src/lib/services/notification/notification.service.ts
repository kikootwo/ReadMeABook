/**
 * Component: Notification Service
 * Documentation: documentation/backend/services/notifications.md
 */

import { getEncryptionService } from '../encryption.service';
import { RMABLogger } from '../../utils/logger';
import { prisma } from '../../db';
import { INotificationProvider, MASKED_CONFIG_VALUE, NotificationPayload, ProviderMetadata } from './INotificationProvider';
import { AppriseProvider } from './providers/apprise.provider';
import { DiscordProvider } from './providers/discord.provider';
import { NtfyProvider } from './providers/ntfy.provider';
import { PushoverProvider } from './providers/pushover.provider';
import { isSameServiceUrl, isServiceUrl, savedCredentialUrlMismatch } from '../../utils/saved-credential';

const logger = RMABLogger.create('NotificationService');

export { MASKED_CONFIG_VALUE };

export type MaskedSecretMerge =
  | { ok: true; config: Record<string, any> }
  | { ok: false; error: string };

// Provider registry
const providers = new Map<string, INotificationProvider>();

export function registerProvider(provider: INotificationProvider): void {
  providers.set(provider.type, provider);
}

export function getProvider(type: string): INotificationProvider | undefined {
  return providers.get(type);
}

// Register built-in providers
registerProvider(new AppriseProvider());
registerProvider(new DiscordProvider());
registerProvider(new NtfyProvider());
registerProvider(new PushoverProvider());

export function getRegisteredProviderTypes(): string[] {
  return Array.from(providers.keys());
}

export function getAllProviderMetadata(): ProviderMetadata[] {
  return Array.from(providers.values()).map((p) => p.metadata);
}

export class NotificationService {
  private encryptionService = getEncryptionService();

  /**
   * Send notification to all enabled backends subscribed to the event
   */
  async sendNotification(payload: NotificationPayload): Promise<void> {
    try {
      // Get all enabled backends subscribed to this event
      const backends = await prisma.notificationBackend.findMany({
        where: {
          enabled: true,
          events: {
            array_contains: payload.event,
          },
        },
      });

      if (backends.length === 0) {
        logger.debug(`No backends subscribed to event: ${payload.event}`);
        return;
      }

      logger.info(`Sending notification to ${backends.length} backend(s)`, {
        event: payload.event,
        requestId: payload.requestId,
      });

      // Send to all backends in parallel (atomic per-backend)
      const results = await Promise.allSettled(
        backends.map((backend) =>
          this.sendToBackend(backend.type, backend.config, payload)
        )
      );

      // Log results
      const successful = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      logger.info(`Notification sent: ${successful} succeeded, ${failed} failed`, {
        event: payload.event,
        requestId: payload.requestId,
      });

      // Log individual failures
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.error(`Failed to send to backend ${backends[index].name}`, {
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            backend: backends[index].type,
          });
        }
      });
    } catch (error) {
      logger.error('Failed to send notifications', {
        error: error instanceof Error ? error.message : String(error),
        event: payload.event,
        requestId: payload.requestId,
      });
      // Don't throw - non-blocking
    }
  }

  /**
   * Route notification to type-specific provider
   */
  async sendToBackend(
    type: string,
    config: any,
    payload: NotificationPayload
  ): Promise<void> {
    const provider = getProvider(type);
    if (!provider) {
      throw new Error(`Unsupported backend type: ${type}`);
    }

    const decryptedConfig = this.decryptConfig(provider.sensitiveFields, config);
    return provider.send(decryptedConfig, payload);
  }

  /**
   * Encrypt sensitive config values before saving
   */
  encryptConfig(type: string, config: any): any {
    const provider = getProvider(type);
    if (!provider) {
      return { ...config };
    }

    const encrypted = { ...config };
    for (const field of provider.sensitiveFields) {
      const value = encrypted[field];
      if (!value) continue;
      // Never hand a non-string to encrypt(): its error text would include the value
      if (typeof value !== 'string') throw new Error(`Sensitive field "${field}" is not text`);
      if (!this.encryptionService.isEncryptedFormat(value)) {
        encrypted[field] = this.encryptionService.encrypt(value);
      }
    }
    return encrypted;
  }

  /**
   * Replace masked values in an updated config with the saved values. For providers whose
   * secrets are tied to a server URL (secretBoundUrl), a saved secret is kept only while that
   * URL is unchanged; an empty URL counts as the provider's default on both sides.
   */
  mergeMaskedSecrets(type: string, existingConfig: any, updatedConfig: Record<string, any>): MaskedSecretMerge {
    const provider = getProvider(type);
    const saved = (existingConfig ?? {}) as Record<string, any>;
    const merged: Record<string, any> = { ...updatedConfig };
    const keptSecrets: string[] = [];

    for (const key of Object.keys(merged)) {
      if (merged[key] !== MASKED_CONFIG_VALUE) continue;
      merged[key] = saved[key];
      if (saved[key] && provider?.sensitiveFields.includes(key)) keptSecrets.push(key);
    }

    const binding = provider?.secretBoundUrl;
    if (binding && keptSecrets.length > 0) {
      const labelOf = (key: string) => provider!.metadata.configFields.find((f) => f.name === key)?.label ?? key;
      const labels = keptSecrets.map(labelOf);
      const effectiveUrl = (value: unknown) =>
        typeof value === 'string' && value.trim() ? value.trim() : binding.defaultUrl ?? '';
      const newUrl = effectiveUrl(merged[binding.field]);
      // Apprise has no default server: an empty or scheme-less URL can't be matched to the saved one
      if (!isServiceUrl(newUrl)) {
        return {
          ok: false,
          error: `Enter the full ${labelOf(binding.field)} (starting with http:// or https://) to keep the saved ${labels.join(', ')}.`,
        };
      }
      if (!isSameServiceUrl(newUrl, effectiveUrl(saved[binding.field]))) {
        return { ok: false, error: `${savedCredentialUrlMismatch(binding.credentialKind)} Fields to re-enter: ${labels.join(', ')}.` };
      }
    }

    return { ok: true, config: merged };
  }

  /**
   * Mask sensitive config values for API responses
   */
  maskConfig(type: string, config: any): any {
    const provider = getProvider(type);
    if (!provider) {
      return { ...config };
    }

    // A stored row not yet migrated is shown in its migrated form (credentials lifted out
    // of the URL), so the mask never ends up inside a URL that is later saved back
    const lifted = provider.liftStoredSecrets?.(config ?? {});
    const masked = { ...(lifted ? lifted.config : config) };
    if (lifted?.password) masked[lifted.passwordField] = MASKED_CONFIG_VALUE;

    // A stored server URL that is not a valid http(s) URL can't be migrated; if it holds
    // something like "user:pass@host", show only the part after the last '@'
    const urlField = provider.secretBoundUrl?.field;
    const storedUrl = urlField ? masked[urlField] : undefined;
    if (typeof storedUrl === 'string' && storedUrl.includes('@') && !isServiceUrl(storedUrl)) {
      masked[urlField!] = storedUrl.slice(storedUrl.lastIndexOf('@') + 1);
    }
    for (const field of provider.sensitiveFields) {
      if (masked[field]) {
        masked[field] = MASKED_CONFIG_VALUE;
      }
    }
    return masked;
  }

  /**
   * Prepare a config submitted by the admin (create, update, test): provider
   * normalisation (e.g. credentials out of the Apprise URL), then every non-empty,
   * non-masked sensitive value is encrypted, even one already in the encrypted format.
   * A client-supplied ciphertext is therefore stored as text and never decrypted.
   * Masked values are left for mergeMaskedSecrets.
   */
  prepareSubmittedConfig(type: string, config: Record<string, any>): MaskedSecretMerge {
    const provider = getProvider(type);
    if (!provider) return { ok: true, config: { ...config } };

    const normalized = provider.normalizeSubmittedConfig ? provider.normalizeSubmittedConfig(config) : { ok: true as const, config: { ...config } };
    if (!normalized.ok) return normalized;

    const prepared = { ...normalized.config };
    for (const field of provider.sensitiveFields) {
      const value = prepared[field];
      if (value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string') {
        const label = provider.metadata.configFields.find((f) => f.name === field)?.label ?? field;
        return { ok: false, error: `${label} must be text.` };
      }
      if (value !== MASKED_CONFIG_VALUE) {
        prepared[field] = this.encryptionService.encrypt(value);
      }
    }
    return { ok: true, config: prepared };
  }

  /**
   * Migrated form of a stored config (credentials lifted out of a URL, the password
   * encrypted), or null when it is already current. An empty password is never stored.
   */
  migrateStoredConfig(type: string, config: any): Record<string, any> | null {
    const provider = getProvider(type);
    const lifted = provider?.liftStoredSecrets?.(config ?? {});
    if (!provider || !lifted) return null;

    const migrated = { ...lifted.config };
    if (lifted.password) migrated[lifted.passwordField] = this.encryptionService.encrypt(lifted.password);
    return this.encryptConfig(type, migrated);
  }

  /**
   * Startup migration: move credentials out of stored URLs (Apprise serverUrl userinfo).
   * Compare-and-swap on updatedAt so a concurrent admin save wins; one row's failure
   * does not stop the others. Safe to run repeatedly.
   */
  async migrateStoredSecrets(): Promise<number> {
    let migrated = 0;
    const backends = await prisma.notificationBackend.findMany();
    for (const backend of backends) {
      try {
        const next = this.migrateStoredConfig(backend.type, backend.config);
        if (!next) continue;
        const { count } = await prisma.notificationBackend.updateMany({
          where: { id: backend.id, updatedAt: backend.updatedAt },
          data: { config: next },
        });
        if (count > 0) {
          migrated++;
          logger.info(`Moved credentials out of the server URL for backend: ${backend.name}`);
        }
      } catch (error) {
        logger.error(`Failed to migrate stored credentials for backend: ${backend.name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return migrated;
  }

  /**
   * Re-encrypt any sensitive fields that were stored as plaintext due to
   * the isEncrypted() false-positive bug (URLs with exactly 2 colons).
   * Safe to call multiple times — skips already-encrypted values.
   */
  async reEncryptUnprotectedBackends(): Promise<number> {
    let fixed = 0;

    try {
      const backends = await prisma.notificationBackend.findMany();

      for (const backend of backends) {
        // One bad row must not stop the others
        try {
          const provider = getProvider(backend.type);
          if (!provider) continue;

          const config = backend.config as any;
          let needsUpdate = false;
          const updatedConfig = { ...config };

          for (const field of provider.sensitiveFields) {
            const value = updatedConfig[field];
            if (!value) continue;
            if (typeof value !== 'string') {
              logger.warn(`Skipping non-text sensitive field "${field}" for backend: ${backend.name}`);
              continue;
            }
            if (!this.encryptionService.isEncryptedFormat(value)) {
              updatedConfig[field] = this.encryptionService.encrypt(value);
              needsUpdate = true;
            }
          }

          if (needsUpdate) {
            await prisma.notificationBackend.update({
              where: { id: backend.id },
              data: { config: updatedConfig },
            });
            fixed++;
            logger.info(`Re-encrypted plaintext sensitive fields for backend: ${backend.name}`);
          }
        } catch (error) {
          logger.error(`Failed to re-encrypt backend: ${backend.name}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (fixed > 0) {
        logger.warn(`Re-encrypted ${fixed} backend(s) with unprotected sensitive fields`);
      }
    } catch (error) {
      logger.error('Failed to re-encrypt backends', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return fixed;
  }

  /**
   * Decrypt sensitive config values
   */
  private decryptConfig(sensitiveFields: string[], config: any): any {
    const decrypted = { ...config };
    for (const field of sensitiveFields) {
      if (decrypted[field] && this.encryptionService.isEncryptedFormat(decrypted[field])) {
        decrypted[field] = this.encryptionService.decrypt(decrypted[field]);
      }
    }
    return decrypted;
  }
}

// Singleton instance
let notificationService: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!notificationService) {
    notificationService = new NotificationService();
  }
  return notificationService;
}
