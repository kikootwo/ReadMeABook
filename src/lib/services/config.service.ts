/**
 * Component: Configuration Service
 * Documentation: documentation/backend/services/config.md
 */

import { prisma } from '../db';
import { getEncryptionService } from './encryption.service';

export interface ConfigUpdate {
  key: string;
  value: string;
  encrypted?: boolean;
  category?: string;
  description?: string;
}

export interface PlexConfig {
  serverUrl?: string;
  libraryId?: string;
  authToken?: string;
}

export interface IndexerConfig {
  type?: string; // 'prowlarr' or 'jackett'
  url?: string;
  apiKey?: string;
}

export interface DownloadClientConfig {
  type?: string; // 'qbittorrent' or 'transmission'
  url?: string;
  username?: string;
  password?: string;
}

export interface PathsConfig {
  downloads: string;
  mediaLibrary: string;
}

export interface AutomationConfig {
  checkIntervalSeconds: number;
  maxSearchAttempts: number;
  maxDownloadAttempts: number;
  qualityPreference: string;
  preferredFormat: string;
}

const CONFIG_DEFAULTS: Record<string, string> = {
  'automation.check_interval_seconds': '60',
  'automation.max_search_attempts': '3',
  'automation.max_download_attempts': '2',
  'automation.quality_preference': 'high',
  'automation.preferred_format': 'm4b',
  'system.setup_completed': 'false',
  'system.log_level': 'info',
  'paths.downloads': '/downloads',
  'paths.media_library': '/media',
};

export class ConfigService {
  private encryptionService = getEncryptionService();

  /**
   * Get a single configuration value
   */
  async get(key: string): Promise<string | null> {
    const config = await prisma.configuration.findUnique({
      where: { key },
    });

    if (!config) {
      return CONFIG_DEFAULTS[key] || null;
    }

    if (config.encrypted && config.value) {
      try {
        return this.encryptionService.decrypt(config.value);
      } catch (error) {
        console.error(`Failed to decrypt config key ${key}:`, error);
        return null;
      }
    }

    return config.value;
  }

  /**
   * Get a configuration value or return a default
   */
  async getOrDefault(key: string, defaultValue: string): Promise<string> {
    const value = await this.get(key);
    return value ?? defaultValue;
  }

  /**
   * Get a boolean configuration value
   */
  async getBoolean(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value === 'true';
  }

  /**
   * Get a number configuration value
   */
  async getNumber(key: string): Promise<number> {
    const value = await this.get(key);
    return value ? parseInt(value, 10) : 0;
  }

  /**
   * Get a JSON configuration value
   */
  async getJSON<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Set a single configuration value
   */
  async set(
    key: string,
    value: string,
    encrypted: boolean = false,
    category?: string,
    description?: string
  ): Promise<void> {
    const encryptedValue = encrypted ? this.encryptionService.encrypt(value) : value;

    await prisma.configuration.upsert({
      where: { key },
      create: {
        key,
        value: encryptedValue,
        encrypted,
        category,
        description,
      },
      update: {
        value: encryptedValue,
        encrypted,
        category,
        description,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Set multiple configuration values at once
   */
  async setMany(updates: ConfigUpdate[]): Promise<void> {
    await Promise.all(
      updates.map((update) =>
        this.set(
          update.key,
          update.value,
          update.encrypted,
          update.category,
          update.description
        )
      )
    );
  }

  /**
   * Get all configuration for a category
   */
  async getCategory(category: string): Promise<Record<string, string>> {
    const configs = await prisma.configuration.findMany({
      where: { category },
    });

    const result: Record<string, string> = {};

    for (const config of configs) {
      const keyParts = config.key.split('.');
      const shortKey = keyParts[keyParts.length - 1];

      if (config.encrypted && config.value) {
        try {
          result[shortKey] = this.encryptionService.decrypt(config.value);
        } catch (error) {
          console.error(`Failed to decrypt ${config.key}:`, error);
          result[shortKey] = '***';
        }
      } else {
        result[shortKey] = config.value || '';
      }
    }

    return result;
  }

  /**
   * Get Plex configuration
   */
  async getPlexConfig(): Promise<PlexConfig> {
    return {
      serverUrl: (await this.get('plex.server_url')) || undefined,
      libraryId: (await this.get('plex.library_id')) || undefined,
      authToken: (await this.get('plex.auth_token')) || undefined,
    };
  }

  /**
   * Get indexer configuration
   */
  async getIndexerConfig(): Promise<IndexerConfig> {
    const type = await this.get('indexer.type');

    if (!type) {
      return {};
    }

    return {
      type,
      url: (await this.get(`indexer.${type}.url`)) || undefined,
      apiKey: (await this.get(`indexer.${type}.api_key`)) || undefined,
    };
  }

  /**
   * Get download client configuration
   */
  async getDownloadClientConfig(): Promise<DownloadClientConfig> {
    const type = await this.get('download_client.type');

    if (!type) {
      return {};
    }

    return {
      type,
      url: (await this.get(`download_client.${type}.url`)) || undefined,
      username: (await this.get(`download_client.${type}.username`)) || undefined,
      password: (await this.get(`download_client.${type}.password`)) || undefined,
    };
  }

  /**
   * Get paths configuration
   */
  async getPathsConfig(): Promise<PathsConfig> {
    return {
      downloads: await this.getOrDefault('paths.downloads', '/downloads'),
      mediaLibrary: await this.getOrDefault('paths.media_library', '/media'),
    };
  }

  /**
   * Get automation configuration
   */
  async getAutomationConfig(): Promise<AutomationConfig> {
    return {
      checkIntervalSeconds: await this.getNumber('automation.check_interval_seconds'),
      maxSearchAttempts: await this.getNumber('automation.max_search_attempts'),
      maxDownloadAttempts: await this.getNumber('automation.max_download_attempts'),
      qualityPreference: await this.getOrDefault('automation.quality_preference', 'high'),
      preferredFormat: await this.getOrDefault('automation.preferred_format', 'm4b'),
    };
  }

  /**
   * Check if initial setup is completed
   */
  async isSetupCompleted(): Promise<boolean> {
    return await this.getBoolean('system.setup_completed');
  }

  /**
   * Mark setup as completed
   */
  async markSetupCompleted(): Promise<void> {
    await this.set('system.setup_completed', 'true', false, 'system');
  }

  /**
   * Delete a configuration key
   */
  async delete(key: string): Promise<void> {
    await prisma.configuration.delete({
      where: { key },
    });
  }

  /**
   * Get all configuration keys (with masked encrypted values)
   */
  async getAll(): Promise<Array<{ key: string; value: string; encrypted: boolean; category?: string }>> {
    const configs = await prisma.configuration.findMany();

    return configs.map((config) => ({
      key: config.key,
      value: config.encrypted ? '***' : config.value || '',
      encrypted: config.encrypted,
      category: config.category || undefined,
    }));
  }
}

// Singleton instance
let configService: ConfigService | null = null;

export function getConfigService(): ConfigService {
  if (!configService) {
    configService = new ConfigService();
  }
  return configService;
}
