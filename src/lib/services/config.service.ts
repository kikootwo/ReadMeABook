/**
 * Component: Configuration Service
 * Documentation: documentation/backend/services/config.md
 */

import { prisma } from '@/lib/db';
import { getEncryptionService } from './encryption.service';

/**
 * Configuration update payload
 */
export interface ConfigUpdate {
  key: string;
  value: string;
  encrypted?: boolean;
  category?: string;
  description?: string;
}

/**
 * Plex configuration structure
 */
export interface PlexConfig {
  serverUrl: string | null;
  authToken: string | null;
  libraryId: string | null;
  machineIdentifier: string | null;
}

/**
 * Configuration service for reading settings from database
 */
export class ConfigurationService {
  private cache: Map<string, string> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute

  /**
   * Get a configuration value by key (decrypted if encrypted)
   */
  async get(key: string): Promise<string | null> {
    // Check cache first
    const cached = this.cache.get(key);
    const expiry = this.cacheExpiry.get(key);

    if (cached && expiry && Date.now() < expiry) {
      return cached;
    }

    // Fetch from database
    try {
      const config = await prisma.configuration.findUnique({
        where: { key },
      });

      if (config && config.value) {
        let value = config.value;

        // Decrypt if encrypted
        if (config.encrypted) {
          const encryptionService = getEncryptionService();
          value = encryptionService.decrypt(config.value);
        }

        // Cache the decrypted value
        this.cache.set(key, value);
        this.cacheExpiry.set(key, Date.now() + this.CACHE_TTL);
        return value;
      }

      return null;
    } catch (error) {
      console.error(`[Config] Failed to get config key "${key}":`, error);
      return null;
    }
  }

  /**
   * Get multiple configuration values
   */
  async getMany(keys: string[]): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = {};

    await Promise.all(
      keys.map(async (key) => {
        result[key] = await this.get(key);
      })
    );

    return result;
  }

  /**
   * Get all configuration items for a specific category
   */
  async getCategory(category: string): Promise<Record<string, any>> {
    try {
      const configs = await prisma.configuration.findMany({
        where: { category },
      });

      const result: Record<string, any> = {};

      for (const config of configs) {
        let value = config.value;

        // Decrypt if encrypted
        if (config.encrypted && value) {
          const encryptionService = getEncryptionService();
          value = encryptionService.decrypt(value);
        }

        result[config.key] = {
          value,
          encrypted: config.encrypted,
          description: config.description,
        };
      }

      return result;
    } catch (error) {
      console.error(`[Config] Failed to get category "${category}":`, error);
      return {};
    }
  }

  /**
   * Get all configuration items (with masked sensitive values)
   */
  async getAll(): Promise<Record<string, any>> {
    try {
      const configs = await prisma.configuration.findMany();

      const result: Record<string, any> = {};

      for (const config of configs) {
        result[config.key] = {
          value: config.encrypted ? '***ENCRYPTED***' : config.value,
          encrypted: config.encrypted,
          category: config.category,
          description: config.description,
        };
      }

      return result;
    } catch (error) {
      console.error('[Config] Failed to get all configuration:', error);
      return {};
    }
  }

  /**
   * Set multiple configuration values (encrypts if needed)
   */
  async setMany(updates: ConfigUpdate[]): Promise<void> {
    try {
      const encryptionService = getEncryptionService();

      for (const update of updates) {
        let value = update.value;

        // Encrypt if needed
        if (update.encrypted) {
          value = encryptionService.encrypt(value);
        }

        // Upsert configuration
        await prisma.configuration.upsert({
          where: { key: update.key },
          create: {
            key: update.key,
            value,
            encrypted: update.encrypted || false,
            category: update.category,
            description: update.description,
          },
          update: {
            value,
            encrypted: update.encrypted || false,
            category: update.category,
            description: update.description,
          },
        });

        // Clear cache for this key
        this.clearCache(update.key);
      }
    } catch (error) {
      console.error('[Config] Failed to set configuration:', error);
      throw error;
    }
  }

  /**
   * Get Plex-specific configuration
   */
  async getPlexConfig(): Promise<PlexConfig> {
    const config = await this.getMany([
      'plex_url',
      'plex_token',
      'plex_audiobook_library_id',
      'plex_machine_identifier',
    ]);

    return {
      serverUrl: config.plex_url,
      authToken: config.plex_token,
      libraryId: config.plex_audiobook_library_id,
      machineIdentifier: config.plex_machine_identifier || null,
    };
  }

  /**
   * Get backend mode (Plex or Audiobookshelf)
   */
  async getBackendMode(): Promise<'plex' | 'audiobookshelf'> {
    const mode = await this.get('system.backend_mode');
    return (mode as 'plex' | 'audiobookshelf') || 'plex';
  }

  /**
   * Check if Audiobookshelf mode is enabled
   */
  async isAudiobookshelfMode(): Promise<boolean> {
    return (await this.getBackendMode()) === 'audiobookshelf';
  }

  /**
   * Clear the cache for a specific key or all keys
   */
  clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
      this.cacheExpiry.delete(key);
    } else {
      this.cache.clear();
      this.cacheExpiry.clear();
    }
  }
}

// Singleton instance
let configService: ConfigurationService | null = null;

export function getConfigService(): ConfigurationService {
  if (!configService) {
    configService = new ConfigurationService();
  }
  return configService;
}
