/**
 * Component: Admin Settings Core API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const configServiceMock = vi.hoisted(() => ({
  setMany: vi.fn(),
  clearCache: vi.fn(),
}));
const audibleServiceMock = vi.hoisted(() => ({
  forceReinitialize: vi.fn(),
}));
const jobQueueMock = vi.hoisted(() => ({
  addAudibleRefreshJob: vi.fn(),
}));
const plexServiceMock = vi.hoisted(() => ({
  testConnection: vi.fn(),
}));
const pathMapperMock = vi.hoisted(() => ({
  validate: vi.fn(),
}));
const invalidateQbMock = vi.hoisted(() => vi.fn());
const invalidateSabMock = vi.hoisted(() => vi.fn());
const invalidateDownloadClientManagerMock = vi.hoisted(() => vi.fn());
const downloadClientManagerMock = vi.hoisted(() => ({
  getAllClients: vi.fn(),
  testConnection: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => audibleServiceMock,
}));

vi.mock('@/lib/services/job-queue.service', () => ({
  getJobQueueService: () => jobQueueMock,
}));

vi.mock('@/lib/integrations/plex.service', () => ({
  getPlexService: () => plexServiceMock,
}));

vi.mock('@/lib/utils/path-mapper', () => ({
  PathMapper: pathMapperMock,
}));

vi.mock('@/lib/integrations/qbittorrent.service', () => ({
  invalidateQBittorrentService: invalidateQbMock,
}));

vi.mock('@/lib/integrations/sabnzbd.service', () => ({
  invalidateSABnzbdService: invalidateSabMock,
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => downloadClientManagerMock,
  invalidateDownloadClientManager: invalidateDownloadClientManagerMock,
}));

describe('Admin settings core routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
    // Reset download client manager mocks with default values
    downloadClientManagerMock.getAllClients.mockResolvedValue([]);
    downloadClientManagerMock.testConnection.mockResolvedValue({ success: true, message: 'Connected' });
  });

  it('returns settings payload', async () => {
    prismaMock.configuration.findMany.mockResolvedValueOnce([
      { key: 'plex_url', value: 'http://plex' },
      { key: 'plex_token', value: 'token' },
      { key: 'system.backend_mode', value: 'plex' },
    ]);
    prismaMock.user.count.mockResolvedValueOnce(0);

    const { GET } = await import('@/app/api/admin/settings/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.plex.url).toBe('http://plex');
    expect(payload.backendMode).toBe('plex');
  });

  it('updates Plex settings', async () => {
    plexServiceMock.testConnection.mockResolvedValue({ success: true, info: { machineIdentifier: 'machine' } });
    const request = {
      json: vi.fn().mockResolvedValue({
        url: 'http://plex',
        token: 'token',
        libraryId: 'lib',
        triggerScanAfterImport: true,
      }),
    };

    const { PUT } = await import('@/app/api/admin/settings/plex/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.configuration.upsert).toHaveBeenCalled();
  });

  it('updates download client settings', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        type: 'qbittorrent',
        url: 'http://qbt',
        username: 'user',
        password: 'pass',
        remotePathMappingEnabled: false,
      }),
    };

    const { PUT } = await import('@/app/api/admin/settings/download-client/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(invalidateQbMock).toHaveBeenCalled();
  });

  it('rejects invalid download client types', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        type: 'transmission',
        url: 'http://transmission',
      }),
    };

    const { PUT } = await import('@/app/api/admin/settings/download-client/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Invalid client type/);
  });

  it('rejects missing qBittorrent credentials', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        type: 'qbittorrent',
        url: 'http://qbt',
        password: 'pass',
        remotePathMappingEnabled: false,
      }),
    };

    const { PUT } = await import('@/app/api/admin/settings/download-client/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/URL, username, and password/);
  });

  it('rejects missing SABnzbd credentials', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        type: 'sabnzbd',
        url: 'http://sab',
        remotePathMappingEnabled: false,
      }),
    };

    const { PUT } = await import('@/app/api/admin/settings/download-client/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/API key/);
  });

  it('rejects path mapping when required fields are missing', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        type: 'qbittorrent',
        url: 'http://qbt',
        username: 'user',
        password: 'pass',
        remotePathMappingEnabled: true,
      }),
    };

    const { PUT } = await import('@/app/api/admin/settings/download-client/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Remote path and local path/);
  });

  it('rejects invalid path mapping configuration', async () => {
    pathMapperMock.validate.mockImplementationOnce(() => {
      throw new Error('bad mapping');
    });
    const request = {
      json: vi.fn().mockResolvedValue({
        type: 'qbittorrent',
        url: 'http://qbt',
        username: 'user',
        password: 'pass',
        remotePathMappingEnabled: true,
        remotePath: '/remote',
        localPath: '/local',
      }),
    };

    const { PUT } = await import('@/app/api/admin/settings/download-client/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/bad mapping/);
  });

  it('updates paths settings', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        downloadDir: '/downloads',
        mediaDir: '/media',
        metadataTaggingEnabled: true,
        chapterMergingEnabled: false,
      }),
    };

    const { PUT } = await import('@/app/api/admin/settings/paths/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(invalidateQbMock).toHaveBeenCalled();
  });

  it('updates paths settings with custom audiobook path template', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        downloadDir: '/downloads',
        mediaDir: '/media',
        audiobookPathTemplate: '{author}/{title} - {narrator}',
        metadataTaggingEnabled: true,
        chapterMergingEnabled: false,
      }),
    };

    const { PUT } = await import('@/app/api/admin/settings/paths/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'audiobook_path_template' },
        update: { value: '{author}/{title} - {narrator}' },
      })
    );
  });

  it('rejects paths settings when directories are the same', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        downloadDir: '/same',
        mediaDir: '/same',
        metadataTaggingEnabled: true,
        chapterMergingEnabled: false,
      }),
    };

    const { PUT } = await import('@/app/api/admin/settings/paths/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('must be different');
  });

  it('rejects paths settings when directories are missing', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        downloadDir: '',
        mediaDir: '/media',
        metadataTaggingEnabled: true,
        chapterMergingEnabled: false,
      }),
    };

    const { PUT } = await import('@/app/api/admin/settings/paths/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('required');
  });

  it('updates Prowlarr settings', async () => {
    const request = { json: vi.fn().mockResolvedValue({ url: 'http://prowlarr', apiKey: 'key' }) };

    const { PUT } = await import('@/app/api/admin/settings/prowlarr/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
  });

  it('updates registration settings', async () => {
    const request = { json: vi.fn().mockResolvedValue({ enabled: true, requireAdminApproval: false }) };

    const { PUT } = await import('@/app/api/admin/settings/registration/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(configServiceMock.setMany).toHaveBeenCalled();
  });

  it('updates OIDC settings', async () => {
    const request = { json: vi.fn().mockResolvedValue({ enabled: true, providerName: 'OIDC', clientSecret: 'secret' }) };

    const { PUT } = await import('@/app/api/admin/settings/oidc/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(configServiceMock.setMany).toHaveBeenCalled();
  });

  it('updates ebook settings', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ enabled: true, format: 'epub', baseUrl: 'https://annas-archive.li' }),
    };

    const { PUT } = await import('@/app/api/admin/settings/ebook/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(configServiceMock.setMany).toHaveBeenCalled();
  });

  it('updates Audible region and triggers refresh', async () => {
    const request = { json: vi.fn().mockResolvedValue({ region: 'us' }) };

    const { PUT } = await import('@/app/api/admin/settings/audible/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(jobQueueMock.addAudibleRefreshJob).toHaveBeenCalled();
  });

  it('updates Audiobookshelf settings', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        serverUrl: 'http://abs',
        apiToken: 'token',
        libraryId: 'lib',
        triggerScanAfterImport: true,
      }),
    };

    const { PUT } = await import('@/app/api/admin/settings/audiobookshelf/route');
    const response = await PUT(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(configServiceMock.setMany).toHaveBeenCalled();
  });
});


