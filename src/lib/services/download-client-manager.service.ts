/**
 * Component: Download Client Manager Service
 * Documentation: documentation/phase3/download-clients.md
 *
 * Manages multiple download clients (qBittorrent, Transmission, Deluge, SABnzbd, NZBGet) with protocol-based routing.
 * Supports migration from legacy single-client config to multi-client JSON array format.
 */

import { randomUUID } from 'crypto';
import path from 'path';
import { ConfigurationService } from './config.service';
import { getEncryptionService } from './encryption.service';
import { serializeDownloadClients } from './download-client-storage';
import { RMABLogger } from '@/lib/utils/logger';
import { QBittorrentService } from '@/lib/integrations/qbittorrent.service';
import { SABnzbdService } from '@/lib/integrations/sabnzbd.service';
import { NZBGetService } from '@/lib/integrations/nzbget.service';
import { TransmissionService } from '@/lib/integrations/transmission.service';
import { DelugeService } from '@/lib/integrations/deluge.service';
import { PathMappingConfig } from '@/lib/utils/path-mapper';
import { IDownloadClient, DownloadClientType, ProtocolType, CLIENT_PROTOCOL_MAP, getClientDisplayName } from '@/lib/interfaces/download-client.interface';

const logger = RMABLogger.create('DownloadClientManager');

export interface DownloadClientConfig {
  id: string;
  type: DownloadClientType;
  name: string;
  enabled: boolean;
  url: string;
  username?: string; // qBittorrent/Transmission/NZBGet only
  password: string; // Password (qBittorrent/Transmission/NZBGet) or API key (SABnzbd)
  disableSSLVerify: boolean;
  remotePathMappingEnabled: boolean;
  remotePath?: string;
  localPath?: string;
  category?: string; // Default: 'readmeabook'
  customPath?: string; // Relative sub-path appended to download_dir
  postImportCategory?: string; // Category to assign after import (torrent clients only)
}


/**
 * Download Client Manager
 *
 * Provides centralized management of multiple download clients with:
 * - Protocol-based routing (torrent → qBittorrent, usenet → SABnzbd)
 * - Auto-migration from legacy single-client config
 * - Singleton caching with invalidation
 * - Connection testing
 */
export class DownloadClientManager {
  private static instance: DownloadClientManager | null = null;
  private configService: ConfigurationService;
  private clientsCache: DownloadClientConfig[] | null = null;
  private serviceCache: Map<string, IDownloadClient> = new Map();
  private migrationPerformed = false;

  private constructor(configService: ConfigurationService) {
    this.configService = configService;
  }

  static getInstance(configService?: ConfigurationService): DownloadClientManager {
    if (!DownloadClientManager.instance) {
      if (!configService) {
        throw new Error('ConfigurationService required for first initialization');
      }
      DownloadClientManager.instance = new DownloadClientManager(configService);
    }
    return DownloadClientManager.instance;
  }

  /**
   * Invalidate cached clients (call after config changes)
   */
  static invalidate(): void {
    if (DownloadClientManager.instance) {
      DownloadClientManager.instance.clientsCache = null;
      DownloadClientManager.instance.serviceCache.clear();
      DownloadClientManager.instance.migrationPerformed = false;
      logger.debug('Download client cache invalidated');
    }
  }

  /**
   * Get all configured download clients
   */
  async getAllClients(): Promise<DownloadClientConfig[]> {
    if (this.clientsCache) {
      return this.clientsCache;
    }

    // Read from database
    const configValue = await this.configService.get('download_clients');

    if (configValue) {
      try {
        const clients = JSON.parse(configValue) as DownloadClientConfig[];

        // Decrypt passwords if they're in encrypted format
        const encryptionService = getEncryptionService();
        const decryptedClients = clients.map(client => {
          if (client.password && encryptionService.isEncryptedFormat(client.password)) {
            try {
              return {
                ...client,
                password: encryptionService.decrypt(client.password),
              };
            } catch (error) {
              logger.error(`Failed to decrypt password for client ${client.name}`, { error });
              return client;
            }
          }
          return client;
        });

        this.clientsCache = decryptedClients;
        return decryptedClients;
      } catch (error) {
        logger.error('Failed to parse download_clients config', { error });
        return [];
      }
    }

    // Check for legacy config and migrate
    if (!this.migrationPerformed) {
      const migrated = await this.migrateLegacyConfig();
      this.migrationPerformed = true;
      if (migrated) {
        return this.getAllClients(); // Recursive call after migration
      }
    }

    return [];
  }

  /**
   * Get client for specific protocol.
   * Uses CLIENT_PROTOCOL_MAP so any client type matching the protocol is found
   * (e.g. both qBittorrent and Transmission can serve the 'torrent' protocol).
   */
  async getClientForProtocol(protocol: ProtocolType): Promise<DownloadClientConfig | null> {
    const clients = await this.getAllClients();

    const client = clients.find(c => c.enabled && CLIENT_PROTOCOL_MAP[c.type] === protocol);

    if (!client) {
      logger.warn(`No enabled ${protocol} client configured`);
      return null;
    }

    return client;
  }

  /**
   * Check if protocol is configured
   */
  async hasClientForProtocol(protocol: ProtocolType): Promise<boolean> {
    const client = await this.getClientForProtocol(protocol);
    return client !== null;
  }

  /**
   * Get instantiated client service for protocol.
   * Returns the unified IDownloadClient interface for protocol-agnostic usage.
   */
  async getClientServiceForProtocol(protocol: ProtocolType): Promise<IDownloadClient | null> {
    const client = await this.getClientForProtocol(protocol);

    if (!client) {
      return null;
    }

    return this.getOrCreateService(client);
  }

  /**
   * Factory: create a new IDownloadClient from config.
   * This is the single place where client type maps to a concrete class.
   * Add new client types (e.g. Transmission, NZBGet) here.
   */
  private async createService(config: DownloadClientConfig): Promise<IDownloadClient> {
    const baseDir = await this.configService.get('download_dir') || '/downloads';
    const downloadDir = config.customPath
      ? path.join(baseDir, config.customPath)
      : baseDir;

    switch (config.type) {
      case 'qbittorrent':
        return this.createQBittorrentService(config, downloadDir);
      case 'sabnzbd':
        return this.createSABnzbdService(config, downloadDir);
      case 'nzbget':
        return this.createNZBGetService(config, downloadDir);
      case 'transmission':
        return this.createTransmissionService(config, downloadDir);
      case 'deluge':
        return this.createDelugeService(config, downloadDir);
      default:
        throw new Error(`Unsupported download client type: ${config.type}`);
    }
  }

  /**
   * Get a cached service instance or create a new one.
   * Caches by client config ID to preserve session state (e.g. qBittorrent SID cookie).
   */
  private async getOrCreateService(config: DownloadClientConfig): Promise<IDownloadClient> {
    const cached = this.serviceCache.get(config.id);
    if (cached) {
      return cached;
    }

    const service = await this.createService(config);
    this.serviceCache.set(config.id, service);
    return service;
  }

  /**
   * Create an IDownloadClient instance from a config object.
   * Uses cached instances when available to preserve session state.
   */
  async createClientFromConfig(config: DownloadClientConfig): Promise<IDownloadClient> {
    return this.getOrCreateService(config);
  }

  /**
   * Test connection for a specific client config.
   * Uses the unified IDownloadClient.testConnection() method.
   */
  async testConnection(config: DownloadClientConfig): Promise<{ success: boolean; message: string }> {
    try {
      // Always create a fresh instance for connection testing (don't use cache)
      const service = await this.createService(config);
      const result = await service.testConnection();

      if (result.success) {
        const versionSuffix = result.version ? ` (v${result.version})` : '';
        return { success: true, message: `Successfully connected to ${config.name}${versionSuffix}` };
      }

      return { success: false, message: result.message || 'Connection failed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Connection test failed', { type: config.type, error: message });
      return { success: false, message };
    }
  }

  /**
   * Create qBittorrent service instance
   */
  private createQBittorrentService(config: DownloadClientConfig, downloadDir: string): QBittorrentService {
    const pathMapping: PathMappingConfig | undefined = config.remotePathMappingEnabled && config.remotePath && config.localPath
      ? {
          enabled: true,
          remotePath: config.remotePath,
          localPath: config.localPath,
        }
      : undefined;

    return new QBittorrentService(
      config.url,
      config.username || '',
      config.password || '', // Optional for IP whitelist auth
      downloadDir,
      config.category || 'readmeabook',
      config.disableSSLVerify,
      pathMapping
    );
  }

  /**
   * Create SABnzbd service instance
   */
  private createSABnzbdService(config: DownloadClientConfig, downloadDir: string): SABnzbdService {
    const pathMapping: PathMappingConfig | undefined = config.remotePathMappingEnabled && config.remotePath && config.localPath
      ? {
          enabled: true,
          remotePath: config.remotePath,
          localPath: config.localPath,
        }
      : undefined;

    return new SABnzbdService(
      config.url,
      config.password, // API key stored in password field
      config.category || 'readmeabook',
      downloadDir,
      config.disableSSLVerify,
      pathMapping
    );
  }

  /**
   * Create NZBGet service instance
   */
  private createNZBGetService(config: DownloadClientConfig, downloadDir: string): NZBGetService {
    const pathMapping: PathMappingConfig | undefined = config.remotePathMappingEnabled && config.remotePath && config.localPath
      ? {
          enabled: true,
          remotePath: config.remotePath,
          localPath: config.localPath,
        }
      : undefined;

    return new NZBGetService(
      config.url,
      config.username || '',
      config.password,
      config.category || 'readmeabook',
      downloadDir,
      config.disableSSLVerify,
      pathMapping
    );
  }

  /**
   * Create Transmission service instance
   */
  private createTransmissionService(config: DownloadClientConfig, downloadDir: string): TransmissionService {
    const pathMapping: PathMappingConfig | undefined = config.remotePathMappingEnabled && config.remotePath && config.localPath
      ? {
          enabled: true,
          remotePath: config.remotePath,
          localPath: config.localPath,
        }
      : undefined;

    return new TransmissionService(
      config.url,
      config.username || '',
      config.password || '',
      downloadDir,
      config.category || 'readmeabook',
      config.disableSSLVerify,
      pathMapping
    );
  }

  /**
   * Create Deluge service instance
   */
  private createDelugeService(config: DownloadClientConfig, downloadDir: string): DelugeService {
    const pathMapping: PathMappingConfig | undefined = config.remotePathMappingEnabled && config.remotePath && config.localPath
      ? {
          enabled: true,
          remotePath: config.remotePath,
          localPath: config.localPath,
        }
      : undefined;

    return new DelugeService(
      config.url,
      config.username || '',
      config.password || '',
      downloadDir,
      config.category || 'readmeabook',
      config.disableSSLVerify,
      pathMapping
    );
  }

  /**
   * Migrate legacy single-client config to new multi-client format
   */
  private async migrateLegacyConfig(): Promise<boolean> {
    logger.info('Checking for legacy download client config...');

    const [
      clientType,
      clientUrl,
      clientUsername,
      clientPassword,
      disableSSLVerify,
      remotePathMappingEnabled,
      remotePath,
      localPath,
      category,
    ] = await Promise.all([
      this.configService.get('download_client_type'),
      this.configService.get('download_client_url'),
      this.configService.get('download_client_username'),
      this.configService.get('download_client_password'),
      this.configService.get('download_client_disable_ssl_verify'),
      this.configService.get('download_client_remote_path_mapping_enabled'),
      this.configService.get('download_client_remote_path'),
      this.configService.get('download_client_local_path'),
      this.configService.get('sabnzbd_category'),
    ]);

    // Check if legacy config exists
    if (!clientType || !clientUrl || !clientPassword) {
      logger.info('No legacy config found');
      return false;
    }

    logger.info(`Migrating legacy ${clientType} config...`);

    const newClient: DownloadClientConfig = {
      id: randomUUID(),
      type: clientType as DownloadClientType,
      name: getClientDisplayName(clientType),
      enabled: true,
      url: clientUrl,
      username: clientUsername || undefined,
      password: clientPassword,
      disableSSLVerify: disableSSLVerify === 'true',
      remotePathMappingEnabled: remotePathMappingEnabled === 'true',
      remotePath: remotePath || undefined,
      localPath: localPath || undefined,
      category: category || 'readmeabook',
    };

    // Save to new format (password encrypted; the cache keeps it decrypted)
    const newConfig = [newClient];
    await this.configService.setMany([
      { key: 'download_clients', value: serializeDownloadClients(newConfig) },
    ]);

    logger.info('Migration completed successfully', {
      type: newClient.type,
      name: newClient.name,
      id: newClient.id
    });

    // Update cache
    this.clientsCache = newConfig;

    return true;
  }
}

/**
 * Get or create singleton instance
 */
export function getDownloadClientManager(configService?: ConfigurationService): DownloadClientManager {
  return DownloadClientManager.getInstance(configService);
}

/**
 * Invalidate singleton (call after config changes)
 */
export function invalidateDownloadClientManager(): void {
  DownloadClientManager.invalidate();
}
