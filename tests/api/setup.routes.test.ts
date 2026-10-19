/**
 * Component: Setup API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const bcryptMock = vi.hoisted(() => ({
  hash: vi.fn(),
}));
const encryptionMock = vi.hoisted(() => ({
  encrypt: vi.fn((value: string) => `enc-${value}`),
  isEncryptedFormat: vi.fn((value: string) => typeof value === 'string' && value.startsWith('enc-')),
}));
const generateAccessTokenMock = vi.hoisted(() => vi.fn(() => 'access-token'));
const generateRefreshTokenMock = vi.hoisted(() => vi.fn(() => 'refresh-token'));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('bcrypt', () => ({
  default: bcryptMock,
  ...bcryptMock,
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => encryptionMock,
}));

vi.mock('@/lib/utils/jwt', () => ({
  generateAccessToken: generateAccessTokenMock,
  generateRefreshToken: generateRefreshTokenMock,
}));

describe('Setup routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns setup status from configuration', async () => {
    prismaMock.configuration.findUnique.mockResolvedValueOnce({ value: 'true' });
    const { GET } = await import('@/app/api/setup/status/route');

    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.setupComplete).toBe(true);
  });

  it('rejects invalid backend mode on setup completion', async () => {
    const { POST } = await import('@/app/api/setup/complete/route');

    const response = await POST({ json: vi.fn().mockResolvedValue({ backendMode: 'invalid' }) } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Invalid or missing backend mode/);
  });

  it('completes setup for Plex mode and returns tokens', async () => {
    bcryptMock.hash.mockResolvedValue('hashed');
    prismaMock.user.create.mockResolvedValue({
      id: 'admin-1',
      plexId: 'local-admin',
      plexUsername: 'admin',
      plexEmail: null,
      role: 'admin',
      avatarUrl: null,
    });
    prismaMock.configuration.upsert.mockResolvedValue({});
    prismaMock.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.bookDateConfig.findFirst.mockResolvedValue(null);

    const { POST } = await import('@/app/api/setup/complete/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        backendMode: 'plex',
        admin: { username: 'admin', password: 'pass' },
        plex: { url: 'http://plex', token: 'token', audiobook_library_id: 'lib', machine_identifier: 'machine' },
        prowlarr: { url: 'http://prowlarr', api_key: 'key', indexers: [{ id: 1 }] },
        downloadClient: { type: 'qbittorrent', url: 'http://qbt', username: 'u', password: 'p' },
        paths: { download_dir: '/downloads', media_dir: '/media' },
      }),
    } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.accessToken).toBe('access-token');
    expect(prismaMock.configuration.upsert).toHaveBeenCalled();
  });

  it('completes setup for Audiobookshelf with both auth methods', async () => {
    bcryptMock.hash.mockResolvedValue('hashed');
    prismaMock.user.create.mockResolvedValue({
      id: 'admin-2',
      plexId: 'local-admin',
      plexUsername: 'admin',
      plexEmail: null,
      role: 'admin',
      avatarUrl: null,
    });
    prismaMock.configuration.upsert.mockResolvedValue({});
    prismaMock.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.bookDateConfig.findFirst.mockResolvedValue({ id: 'bookdate-1' });
    prismaMock.bookDateConfig.update.mockResolvedValue({});

    const { POST } = await import('@/app/api/setup/complete/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        backendMode: 'audiobookshelf',
        admin: { username: 'admin', password: 'pass' },
        authMethod: 'both',
        audiobookshelf: {
          server_url: 'http://abs',
          api_token: 'abs-token',
          library_id: 'lib',
          trigger_scan_after_import: true,
        },
        oidc: {
          provider_name: 'OIDC',
          issuer_url: 'https://issuer',
          client_id: 'client-id',
          client_secret: 'client-secret',
          access_control_method: 'open',
          access_group_claim: 'groups',
          access_group_value: '',
          allowed_emails: '[]',
          allowed_usernames: '[]',
          admin_claim_enabled: 'true',
          admin_claim_name: 'groups',
          admin_claim_value: 'admins',
        },
        registration: { require_admin_approval: true },
        prowlarr: { url: 'http://prowlarr', api_key: 'key', indexers: [{ id: 1 }] },
        downloadClient: {
          type: 'qbittorrent',
          url: 'http://qbt',
          username: 'u',
          password: 'p',
          disableSSLVerify: true,
          remotePathMappingEnabled: true,
          remotePath: '/remote',
          localPath: '/local',
        },
        paths: {
          download_dir: '/downloads',
          media_dir: '/media',
          metadata_tagging_enabled: false,
          chapter_merging_enabled: true,
        },
        bookdate: { provider: 'openai', apiKey: 'bd-key', model: 'gpt-4' },
      }),
    } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.accessToken).toBe('access-token');
    expect(prismaMock.bookDateConfig.update).toHaveBeenCalled();
  });

  it('completes setup for Audiobookshelf without admin user', async () => {
    prismaMock.configuration.upsert.mockResolvedValue({});
    prismaMock.scheduledJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.bookDateConfig.findFirst.mockResolvedValue(null);

    const { POST } = await import('@/app/api/setup/complete/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        backendMode: 'audiobookshelf',
        authMethod: 'oidc',
        audiobookshelf: {
          server_url: 'http://abs',
          api_token: 'abs-token',
          library_id: 'lib',
        },
        oidc: {
          provider_name: 'OIDC',
          issuer_url: 'https://issuer',
          client_id: 'client-id',
          client_secret: 'client-secret',
        },
        prowlarr: { url: 'http://prowlarr', api_key: 'key', indexers: [{ id: 1 }] },
        downloadClient: { type: 'qbittorrent', url: 'http://qbt', username: 'u', password: 'p' },
        paths: { download_dir: '/downloads', media_dir: '/media' },
      }),
    } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.accessToken).toBeUndefined();
  });
});


