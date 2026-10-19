/**
 * Component: Notification Service
 * Documentation: documentation/backend/services/notifications.md
 */

import { getEncryptionService } from '../encryption.service';
import { RMABLogger } from '../../utils/logger';
import { prisma } from '../../db';
import { INotificationProvider, NotificationPayload, ProviderMetadata } from './INotificationProvider';
import { AppriseProvider } from './providers/apprise.provider';
import { DiscordProvider } from './providers/discord.provider';
import { NtfyProvider } from './providers/ntfy.provider';
import { PushoverProvider } from './providers/pushover.provider';
import { isSameServiceUrl, isServiceUrl, savedCredentialUrlMismatch } from '../../utils/saved-credential';

const logger = RMABLogger.create('NotificationService');

/** Placeholder sent to the UI instead of a saved sensitive value */
export const MASKED_CONFIG_VALUE = '••••••••';

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
      if (encrypted[field] && !this.encryptionService.isEncryptedFormat(encrypted[field])) {
        encrypted[field] = this.encryptionService.encrypt(encrypted[field]);
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

    const masked = { ...config };
    for (const field of provider.sensitiveFields) {
      if (masked[field]) {
        masked[field] = MASKED_CONFIG_VALUE;
      }
    }
    return masked;
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
        const provider = getProvider(backend.type);
        if (!provider) continue;

        const config = backend.config as any;
        let needsUpdate = false;
        const updatedConfig = { ...config };

        for (const field of provider.sensitiveFields) {
          if (updatedConfig[field] && !this.encryptionService.isEncryptedFormat(updatedConfig[field])) {
            updatedConfig[field] = this.encryptionService.encrypt(updatedConfig[field]);
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
