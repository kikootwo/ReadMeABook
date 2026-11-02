/**
 * Component: Download Client Manager Service Tests
 * Documentation: documentation/phase3/download-clients.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();

const configMock = vi.hoisted(() => ({
  get: vi.fn(),
  setMany: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configMock,
}));

// Mock encryption service: "enc-" marks ciphertext; most test passwords are plaintext
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({
    encrypt: (value: string) => `enc-${value}`,
    decrypt: (value: string) => value.replace('enc-', ''),
    isEncryptedFormat: (value: string) => typeof value === 'string' && value.startsWith('enc-'),
  }),
}));

// Mock all 4 download client services - use vi.hoisted to ensure they're available at mock time
const { qbtServiceMock, sabServiceMock, transmissionServiceMock, nzbgetServiceMock } = vi.hoisted(() => ({
  qbtServiceMock: {
    testConnection: vi.fn(),
  },
  sabServiceMock: {
    testConnection: vi.fn(),
  },
  transmissionServiceMock: {
    testConnection: vi.fn(),
  },
  nzbgetServiceMock: {
    testConnection: vi.fn(),
  },
}));

// Use class syntax for proper constructor mocking
vi.mock('@/lib/integrations/qbittorrent.service', () => ({
  QBittorrentService: class MockQBittorrentService {
    testConnection = qbtServiceMock.testConnection;
  },
}));

vi.mock('@/lib/integrations/sabnzbd.service', () => ({
  SABnzbdService: class MockSABnzbdService {
    testConnection = sabServiceMock.testConnection;
  },
}));

vi.mock('@/lib/integrations/transmission.service', () => ({
  TransmissionService: class MockTransmissionService {
    testConnection = transmissionServiceMock.testConnection;
  },
}));

vi.mock('@/lib/integrations/nzbget.service', () => ({
  NZBGetService: class MockNZBGetService {
    testConnection = nzbgetServiceMock.testConnection;
  },
}));

describe('DownloadClientManager', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset singleton using dynamic import
    const { invalidateDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
    invalidateDownloadClientManager();
  });

  describe('getAllClients', () => {
    it('returns parsed clients from config', async () => {
      const clients = [
        {
          id: 'client-1',
          type: 'qbittorrent',
          name: 'qBittorrent',
          enabled: true,
          url: 'http://localhost:8080',
          username: 'admin',
          password: 'password',
          disableSSLVerify: false,
          remotePathMappingEnabled: false,
          category: 'readmeabook',
        },
      ];

      configMock.get.mockResolvedValue(JSON.stringify(clients));

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const result = await manager.getAllClients();

      expect(result).toEqual(clients);
      expect(configMock.get).toHaveBeenCalledWith('download_clients');
    });

    it('returns empty array when no clients configured', async () => {
      configMock.get.mockResolvedValue(null);

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const result = await manager.getAllClients();

      expect(result).toEqual([]);
    });

    it('caches clients for subsequent calls', async () => {
      const clients = [
        {
          id: 'client-1',
          type: 'qbittorrent',
          name: 'qBittorrent',
          enabled: true,
          url: 'http://localhost:8080',
          username: 'admin',
          password: 'password',
          disableSSLVerify: false,
          remotePathMappingEnabled: false,
          category: 'readmeabook',
        },
      ];

      configMock.get.mockResolvedValue(JSON.stringify(clients));

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      await manager.getAllClients();
      await manager.getAllClients();

      expect(configMock.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getClientForProtocol', () => {
    it('returns qBittorrent client for torrent protocol', async () => {
      const clients = [
        {
          id: 'client-1',
          type: 'qbittorrent',
          name: 'qBittorrent',
          enabled: true,
          url: 'http://localhost:8080',
          username: 'admin',
          password: 'password',
          disableSSLVerify: false,
          remotePathMappingEnabled: false,
          category: 'readmeabook',
        },
      ];

      configMock.get.mockResolvedValue(JSON.stringify(clients));

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const result = await manager.getClientForProtocol('torrent');

      expect(result).toEqual(clients[0]);
    });

    it('returns SABnzbd client for usenet protocol', async () => {
      const clients = [
        {
          id: 'client-1',
          type: 'sabnzbd',
          name: 'SABnzbd',
          enabled: true,
          url: 'http://localhost:8081',
          password: 'apikey',
          disableSSLVerify: false,
          remotePathMappingEnabled: false,
          category: 'readmeabook',
        },
      ];

      configMock.get.mockResolvedValue(JSON.stringify(clients));

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const result = await manager.getClientForProtocol('usenet');

      expect(result).toEqual(clients[0]);
    });

    it('returns Transmission client for torrent protocol', async () => {
      const clients = [
        {
          id: 'client-1',
          type: 'transmission',
          name: 'Transmission',
          enabled: true,
          url: 'http://localhost:9091',
          username: 'admin',
          password: 'password',
          disableSSLVerify: false,
          remotePathMappingEnabled: false,
          category: 'readmeabook',
        },
      ];

      configMock.get.mockResolvedValue(JSON.stringify(clients));

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const result = await manager.getClientForProtocol('torrent');

      expect(result).toEqual(clients[0]);
    });

    it('returns NZBGet client for usenet protocol', async () => {
      const clients = [
        {
          id: 'client-1',
          type: 'nzbget',
          name: 'NZBGet',
          enabled: true,
          url: 'http://localhost:6789',
          username: 'nzbget',
          password: 'tegbzn6789',
          disableSSLVerify: false,
          remotePathMappingEnabled: false,
          category: 'readmeabook',
        },
      ];

      configMock.get.mockResolvedValue(JSON.stringify(clients));

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const result = await manager.getClientForProtocol('usenet');

      expect(result).toEqual(clients[0]);
    });

    it('returns null when no client configured for protocol', async () => {
      const clients = [
        {
          id: 'client-1',
          type: 'qbittorrent',
          name: 'qBittorrent',
          enabled: true,
          url: 'http://localhost:8080',
          username: 'admin',
          password: 'password',
          disableSSLVerify: false,
          remotePathMappingEnabled: false,
          category: 'readmeabook',
        },
      ];

      configMock.get.mockResolvedValue(JSON.stringify(clients));

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const result = await manager.getClientForProtocol('usenet');

      expect(result).toBeNull();
    });

    it('skips disabled clients', async () => {
      const clients = [
        {
          id: 'client-1',
          type: 'qbittorrent',
          name: 'qBittorrent',
          enabled: false, // Disabled
          url: 'http://localhost:8080',
          username: 'admin',
          password: 'password',
          disableSSLVerify: false,
          remotePathMappingEnabled: false,
          category: 'readmeabook',
        },
      ];

      configMock.get.mockResolvedValue(JSON.stringify(clients));

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const result = await manager.getClientForProtocol('torrent');

      expect(result).toBeNull();
    });
  });

  describe('hasClientForProtocol', () => {
    it('returns true when client is configured', async () => {
      const clients = [
        {
          id: 'client-1',
          type: 'qbittorrent',
          name: 'qBittorrent',
          enabled: true,
          url: 'http://localhost:8080',
          username: 'admin',
          password: 'password',
          disableSSLVerify: false,
          remotePathMappingEnabled: false,
          category: 'readmeabook',
        },
      ];

      configMock.get.mockResolvedValue(JSON.stringify(clients));

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const result = await manager.hasClientForProtocol('torrent');

      expect(result).toBe(true);
    });

    it('returns false when client is not configured', async () => {
      const clients = [
        {
          id: 'client-1',
          type: 'qbittorrent',
          name: 'qBittorrent',
          enabled: true,
          url: 'http://localhost:8080',
          username: 'admin',
          password: 'password',
          disableSSLVerify: false,
          remotePathMappingEnabled: false,
          category: 'readmeabook',
        },
      ];

      configMock.get.mockResolvedValue(JSON.stringify(clients));

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const result = await manager.hasClientForProtocol('usenet');

      expect(result).toBe(false);
    });
  });

  describe('testConnection', () => {
    it('successfully tests qBittorrent connection', async () => {
      qbtServiceMock.testConnection.mockResolvedValue({ success: true, message: 'Connected' });

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const config = {
        id: 'client-1',
        type: 'qbittorrent' as const,
        name: 'qBittorrent',
        enabled: true,
        url: 'http://localhost:8080',
        username: 'admin',
        password: 'password',
        disableSSLVerify: false,
        remotePathMappingEnabled: false,
        category: 'readmeabook',
      };

      const result = await manager.testConnection(config);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Successfully connected to qBittorrent');
    });

    it('successfully tests SABnzbd connection', async () => {
      sabServiceMock.testConnection.mockResolvedValue({ success: true, version: '3.5.0', message: 'Connected' });

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const config = {
        id: 'client-1',
        type: 'sabnzbd' as const,
        name: 'SABnzbd',
        enabled: true,
        url: 'http://localhost:8081',
        password: 'apikey',
        disableSSLVerify: false,
        remotePathMappingEnabled: false,
        category: 'readmeabook',
      };

      const result = await manager.testConnection(config);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Successfully connected to SABnzbd (v3.5.0)');
    });

    it('returns error on connection failure', async () => {
      qbtServiceMock.testConnection.mockRejectedValue(new Error('Connection refused'));

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const config = {
        id: 'client-1',
        type: 'qbittorrent' as const,
        name: 'qBittorrent',
        enabled: true,
        url: 'http://localhost:8080',
        username: 'admin',
        password: 'password',
        disableSSLVerify: false,
        remotePathMappingEnabled: false,
        category: 'readmeabook',
      };

      const result = await manager.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection refused');
    });

    it('successfully tests NZBGet connection', async () => {
      nzbgetServiceMock.testConnection.mockResolvedValue({ success: true, version: '24.2', message: 'Connected' });

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const config = {
        id: 'client-1',
        type: 'nzbget' as const,
        name: 'NZBGet',
        enabled: true,
        url: 'http://localhost:6789',
        username: 'nzbget',
        password: 'tegbzn6789',
        disableSSLVerify: false,
        remotePathMappingEnabled: false,
        category: 'readmeabook',
      };

      const result = await manager.testConnection(config);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Successfully connected to NZBGet (v24.2)');
    });

    it('successfully tests Transmission connection', async () => {
      transmissionServiceMock.testConnection.mockResolvedValue({ success: true, version: '4.0.5', message: 'Connected' });

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const config = {
        id: 'client-1',
        type: 'transmission' as const,
        name: 'Transmission',
        enabled: true,
        url: 'http://localhost:9091',
        username: 'admin',
        password: 'password',
        disableSSLVerify: false,
        remotePathMappingEnabled: false,
        category: 'readmeabook',
      };

      const result = await manager.testConnection(config);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Successfully connected to Transmission (v4.0.5)');
    });
  });

  describe('migration', () => {
    it('migrates legacy single-client config to array format', async () => {
      // First call returns null for download_clients (new format doesn't exist)
      // Then return legacy values for migration
      configMock.get
        .mockResolvedValueOnce(null) // download_clients
        .mockResolvedValueOnce('qbittorrent') // download_client_type
        .mockResolvedValueOnce('http://localhost:8080') // download_client_url
        .mockResolvedValueOnce('admin') // download_client_username
        .mockResolvedValueOnce('password') // download_client_password
        .mockResolvedValueOnce('false') // download_client_disable_ssl_verify
        .mockResolvedValueOnce('false') // download_client_remote_path_mapping_enabled
        .mockResolvedValueOnce(null) // download_client_remote_path
        .mockResolvedValueOnce(null) // download_client_local_path
        .mockResolvedValueOnce(null); // sabnzbd_category

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const result = await manager.getAllClients();

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('qbittorrent');
      expect(result[0].name).toBe('qBittorrent');
      expect(result[0].enabled).toBe(true);
      expect(result[0].url).toBe('http://localhost:8080');
      expect(result[0].username).toBe('admin');
      expect(result[0].password).toBe('password');

      // Should have saved the migrated config, with the password encrypted
      expect(configMock.setMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'download_clients',
            value: expect.stringContaining('qbittorrent'),
          }),
        ])
      );
      const saved = JSON.parse(configMock.setMany.mock.calls[0][0][0].value);
      expect(saved[0].password).toBe('enc-password');
    });

    it('does not migrate when legacy config is incomplete', async () => {
      configMock.get
        .mockResolvedValueOnce(null) // download_clients
        .mockResolvedValueOnce(null) // download_client_type (missing)
        .mockResolvedValueOnce(null) // download_client_url (missing)
        .mockResolvedValueOnce(null); // download_client_password (missing)

      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      const result = await manager.getAllClients();

      expect(result).toEqual([]);
      expect(configMock.setMany).not.toHaveBeenCalled();
    });
  });

  describe('invalidate', () => {
    it('clears cache on invalidation', async () => {
      const clients = [
        {
          id: 'client-1',
          type: 'qbittorrent',
          name: 'qBittorrent',
          enabled: true,
          url: 'http://localhost:8080',
          username: 'admin',
          password: 'password',
          disableSSLVerify: false,
          remotePathMappingEnabled: false,
          category: 'readmeabook',
        },
      ];

      configMock.get.mockResolvedValue(JSON.stringify(clients));

      const { getDownloadClientManager, invalidateDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager(configMock as any);

      await manager.getAllClients(); // First call - caches

      invalidateDownloadClientManager(); // Invalidate cache

      await manager.getAllClients(); // Second call - should fetch again

      expect(configMock.get).toHaveBeenCalledTimes(2);
    });
  });
});
