/**
 * Component: Configuration Service Tests
 * Documentation: documentation/backend/services/config.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { DEFAULT_AUDIBLE_REGION } from '@/lib/types/audible';

const prismaMock = createPrismaMock();

const encryptionMock = vi.hoisted(() => ({
  encrypt: vi.fn((value: string) => `enc:${value}`),
  decrypt: vi.fn((value: string) => value.replace('enc:', '')),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => encryptionMock,
}));

describe('ConfigurationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('decrypts encrypted values on get', async () => {
    prismaMock.configuration.findUnique.mockResolvedValue({
      key: 'plex.auth_token',
      value: 'enc:secret',
      encrypted: true,
    });

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();
    const value = await service.get('plex.auth_token');

    expect(value).toBe('secret');
    expect(encryptionMock.decrypt).toHaveBeenCalledWith('enc:secret');
  });

  it('caches values for subsequent get calls', async () => {
    prismaMock.configuration.findUnique.mockResolvedValue({
      key: 'system.log_level',
      value: 'info',
      encrypted: false,
    });

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();

    const first = await service.get('system.log_level');
    const second = await service.get('system.log_level');

    expect(first).toBe('info');
    expect(second).toBe('info');
    expect(prismaMock.configuration.findUnique).toHaveBeenCalledTimes(1);
  });

  it('encrypts values when setting encrypted config', async () => {
    prismaMock.configuration.upsert.mockResolvedValue({});

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();

    await service.setMany([
      { key: 'plex.auth_token', value: 'secret', encrypted: true },
    ]);

    expect(encryptionMock.encrypt).toHaveBeenCalledWith('secret');
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          value: 'enc:secret',
          encrypted: true,
        }),
      })
    );
  });

  it('writes setManyAtomic updates in one transaction, encrypting where asked', async () => {
    prismaMock.configuration.upsert.mockImplementation((args: unknown) => args);
    prismaMock.$transaction.mockResolvedValue([]);

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();

    await service.setManyAtomic([
      { key: 'oidc.client_secret', value: 'secret', encrypted: true },
      { key: 'oidc.issuer_url', value: 'https://auth.example' },
    ]);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const writes = prismaMock.$transaction.mock.calls[0][0];
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ where: { key: 'oidc.client_secret' }, create: { value: 'enc:secret', encrypted: true } });
    expect(writes[1]).toMatchObject({ where: { key: 'oidc.issuer_url' }, create: { value: 'https://auth.example', encrypted: false } });
  });

  it('rethrows when the setManyAtomic transaction fails', async () => {
    prismaMock.configuration.upsert.mockImplementation((args: unknown) => args);
    prismaMock.$transaction.mockRejectedValue(new Error('deadlock'));

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();

    await expect(service.setManyAtomic([{ key: 'a', value: '1' }])).rejects.toThrow('deadlock');
  });

  it('returns default Audible region when not configured', async () => {
    prismaMock.configuration.findUnique.mockResolvedValue(null);

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();
    const region = await service.getAudibleRegion();

    expect(region).toBe(DEFAULT_AUDIBLE_REGION);
  });

  it('returns decrypted values for a category', async () => {
    prismaMock.configuration.findMany.mockResolvedValue([
      {
        key: 'plex.token',
        value: 'enc:secret',
        encrypted: true,
        description: 'Plex token',
      },
    ]);

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();
    const category = await service.getCategory('plex');

    expect(category['plex.token'].value).toBe('secret');
    expect(category['plex.token'].encrypted).toBe(true);
  });

  it('masks encrypted values when listing all config', async () => {
    prismaMock.configuration.findMany.mockResolvedValue([
      {
        key: 'plex.token',
        value: 'secret',
        encrypted: true,
        category: 'plex',
        description: 'Plex token',
      },
    ]);

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();
    const all = await service.getAll();

    expect(all['plex.token'].value).toBe('***ENCRYPTED***');
    expect(all['plex.token'].category).toBe('plex');
  });

  it('defaults backend mode to plex when unset', async () => {
    prismaMock.configuration.findUnique.mockResolvedValue(null);

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();
    const mode = await service.getBackendMode();

    expect(mode).toBe('plex');
  });

  it('returns true when audiobookshelf mode is enabled', async () => {
    prismaMock.configuration.findUnique.mockResolvedValue({
      key: 'system.backend_mode',
      value: 'audiobookshelf',
      encrypted: false,
    });

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();
    const enabled = await service.isAudiobookshelfMode();

    expect(enabled).toBe(true);
  });

  it('builds Plex config from stored keys', async () => {
    prismaMock.configuration.findUnique.mockImplementation(async ({ where: { key } }) => {
      const values: Record<string, string> = {
        plex_url: 'http://plex',
        plex_token: 'token',
        plex_audiobook_library_id: 'lib-1',
        plex_machine_identifier: 'machine',
      };
      return values[key]
        ? { key, value: values[key], encrypted: false }
        : null;
    });

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();
    const plexConfig = await service.getPlexConfig();

    expect(plexConfig).toEqual({
      serverUrl: 'http://plex',
      authToken: 'token',
      libraryId: 'lib-1',
      machineIdentifier: 'machine',
    });
  });

  it('clears cached entries when requested', async () => {
    prismaMock.configuration.findUnique.mockResolvedValue({
      key: 'system.log_level',
      value: 'info',
      encrypted: false,
    });

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();

    const first = await service.get('system.log_level');
    prismaMock.configuration.findUnique.mockResolvedValue({
      key: 'system.log_level',
      value: 'debug',
      encrypted: false,
    });

    const cached = await service.get('system.log_level');
    service.clearCache('system.log_level');
    const updated = await service.get('system.log_level');

    expect(first).toBe('info');
    expect(cached).toBe('info');
    expect(updated).toBe('debug');
  });

  it('throws when setting configuration fails', async () => {
    prismaMock.configuration.upsert.mockRejectedValue(new Error('db failed'));

    const { ConfigurationService } = await import('@/lib/services/config.service');
    const service = new ConfigurationService();

    await expect(
      service.setMany([{ key: 'system.test', value: '1' }])
    ).rejects.toThrow('db failed');
  });
});


