/**
 * Component: Admin Settings Test API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const plexServiceMock = vi.hoisted(() => ({
  testConnection: vi.fn(),
  getLibraries: vi.fn(),
}));
const prowlarrMock = vi.hoisted(() => ({
  getIndexers: vi.fn(),
}));
const qbtMock = vi.hoisted(() => ({
  testConnectionWithCredentials: vi.fn(),
}));
const sabnzbdMock = vi.hoisted(() => ({
  testConnection: vi.fn(),
}));
const maskedValue = '\u2022\u2022\u2022\u2022';
const testFlareSolverrMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  constants: { R_OK: 4 },
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/integrations/plex.service', () => ({
  getPlexService: () => plexServiceMock,
}));

vi.mock('@/lib/integrations/prowlarr.service', () => ({
  ProwlarrService: class {
    constructor() {}
    getIndexers = prowlarrMock.getIndexers;
  },
}));

vi.mock('@/lib/integrations/qbittorrent.service', () => ({
  QBittorrentService: {
    testConnectionWithCredentials: qbtMock.testConnectionWithCredentials,
  },
}));

vi.mock('@/lib/integrations/sabnzbd.service', () => ({
  SABnzbdService: class {
    constructor() {}
    testConnection = sabnzbdMock.testConnection;
  },
}));

vi.mock('@/lib/services/ebook-scraper', () => ({
  testFlareSolverrConnection: testFlareSolverrMock,
}));

vi.mock('fs/promises', () => ({
  default: fsMock,
  ...fsMock,
}));

describe('Admin settings test routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
    fsMock.access.mockResolvedValue(undefined);
  });

  it('tests Plex connection with stored token', async () => {
    prismaMock.configuration.findUnique.mockResolvedValueOnce({ value: 'token' });
    plexServiceMock.testConnection.mockResolvedValueOnce({ success: true, info: { platform: 'Plex', version: '1.0' } });
    plexServiceMock.getLibraries.mockResolvedValueOnce([{ id: '1', title: 'Books', type: 'book' }]);

    const request = { json: vi.fn().mockResolvedValue({ url: 'http://plex', token: '********' }) };
    const { POST } = await import('@/app/api/admin/settings/test-plex/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
  });

  it('rejects Plex test when URL or token is missing', async () => {
    const request = { json: vi.fn().mockResolvedValue({ url: '', token: 'token' }) };
    const { POST } = await import('@/app/api/admin/settings/test-plex/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/URL and token are required/);
  });

  it('rejects Plex test when masked token is missing in storage', async () => {
    prismaMock.configuration.findUnique.mockResolvedValueOnce(null);
    const request = { json: vi.fn().mockResolvedValue({ url: 'http://plex', token: maskedValue }) };

    const { POST } = await import('@/app/api/admin/settings/test-plex/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/No stored token/);
  });

  it('returns error when Plex connection test fails', async () => {
    plexServiceMock.testConnection.mockResolvedValueOnce({ success: false, message: 'bad token' });
    const request = { json: vi.fn().mockResolvedValue({ url: 'http://plex', token: 'token' }) };

    const { POST } = await import('@/app/api/admin/settings/test-plex/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/bad token/);
  });

  it('tests Prowlarr connection', async () => {
    prowlarrMock.getIndexers.mockResolvedValueOnce([{ id: 1, name: 'Indexer', protocol: 'torrent', enable: true }]);
    const request = { json: vi.fn().mockResolvedValue({ url: 'http://prowlarr', apiKey: 'key' }) };

    const { POST } = await import('@/app/api/admin/settings/test-prowlarr/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
  });

  it('rejects Prowlarr test when URL or API key is missing', async () => {
    const request = { json: vi.fn().mockResolvedValue({ url: 'http://prowlarr' }) };
    const { POST } = await import('@/app/api/admin/settings/test-prowlarr/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/URL and API key are required/);
  });

  it('rejects masked Prowlarr API key when no stored key exists', async () => {
    prismaMock.configuration.findUnique.mockResolvedValueOnce(null);
    const request = { json: vi.fn().mockResolvedValue({ url: 'http://prowlarr', apiKey: maskedValue }) };

    const { POST } = await import('@/app/api/admin/settings/test-prowlarr/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/No stored API key/);
  });

  it('returns error when Prowlarr test fails', async () => {
    prowlarrMock.getIndexers.mockRejectedValueOnce(new Error('prowlarr down'));
    const request = { json: vi.fn().mockResolvedValue({ url: 'http://prowlarr', apiKey: 'key' }) };

    const { POST } = await import('@/app/api/admin/settings/test-prowlarr/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/prowlarr down/);
  });

  it('tests download client connection', async () => {
    qbtMock.testConnectionWithCredentials.mockResolvedValueOnce('4.0.0');
    const request = {
      json: vi.fn().mockResolvedValue({ type: 'qbittorrent', url: 'http://qbt', username: 'user', password: 'pass' }),
    };

    const { POST } = await import('@/app/api/admin/settings/test-download-client/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.version).toBe('4.0.0');
  });

  it('validates required fields for download client testing', async () => {
    const request = { json: vi.fn().mockResolvedValue({ url: 'http://qbt' }) };

    const { POST } = await import('@/app/api/admin/settings/test-download-client/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Type and URL are required/);
  });

  it('rejects invalid download client types', async () => {
    const request = { json: vi.fn().mockResolvedValue({ type: 'invalid', url: 'http://qbt' }) };

    const { POST } = await import('@/app/api/admin/settings/test-download-client/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Invalid client type/);
  });

  it('uses stored password when masked password is provided', async () => {
    prismaMock.configuration.findUnique.mockResolvedValueOnce({ value: 'stored-pass' });
    qbtMock.testConnectionWithCredentials.mockResolvedValueOnce('4.1.0');
    const request = {
      json: vi.fn().mockResolvedValue({
        type: 'qbittorrent',
        url: 'http://qbt',
        username: 'user',
        password: '\u2022\u2022\u2022\u2022',
      }),
    };

    const { POST } = await import('@/app/api/admin/settings/test-download-client/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(qbtMock.testConnectionWithCredentials).toHaveBeenCalledWith(
      'http://qbt',
      'user',
      'stored-pass',
      false
    );
  });

  it('returns error when masked password is missing in storage', async () => {
    prismaMock.configuration.findUnique.mockResolvedValueOnce(null);
    const request = {
      json: vi.fn().mockResolvedValue({
        type: 'qbittorrent',
        url: 'http://qbt',
        username: 'user',
        password: '\u2022\u2022\u2022\u2022',
      }),
    };

    const { POST } = await import('@/app/api/admin/settings/test-download-client/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/No stored password/);
  });

  it('returns error when SABnzbd connection fails', async () => {
    sabnzbdMock.testConnection.mockResolvedValueOnce({ success: false, error: 'bad key' });
    const request = {
      json: vi.fn().mockResolvedValue({ type: 'sabnzbd', url: 'http://sab', password: 'key' }),
    };

    const { POST } = await import('@/app/api/admin/settings/test-download-client/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/bad key/);
  });

  it('requires path mapping values when enabled', async () => {
    qbtMock.testConnectionWithCredentials.mockResolvedValueOnce('4.0.0');
    const request = {
      json: vi.fn().mockResolvedValue({
        type: 'qbittorrent',
        url: 'http://qbt',
        username: 'user',
        password: 'pass',
        remotePathMappingEnabled: true,
      }),
    };

    const { POST } = await import('@/app/api/admin/settings/test-download-client/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Remote path and local path are required/);
  });

  it('rejects inaccessible local path when mapping is enabled', async () => {
    qbtMock.testConnectionWithCredentials.mockResolvedValueOnce('4.0.0');
    fsMock.access.mockRejectedValueOnce(new Error('missing'));
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

    const { POST } = await import('@/app/api/admin/settings/test-download-client/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/not accessible/);
  });

  it('tests FlareSolverr connection', async () => {
    testFlareSolverrMock.mockResolvedValueOnce({ success: true });
    const request = { json: vi.fn().mockResolvedValue({ url: 'http://flare' }) };

    const { POST } = await import('@/app/api/admin/settings/ebook/test-flaresolverr/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
  });

  it('rejects FlareSolverr test when URL is missing', async () => {
    const request = { json: vi.fn().mockResolvedValue({}) };

    const { POST } = await import('@/app/api/admin/settings/ebook/test-flaresolverr/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/URL is required/);
  });

  it('rejects FlareSolverr test when URL has invalid scheme', async () => {
    const request = { json: vi.fn().mockResolvedValue({ url: 'ftp://flare' }) };

    const { POST } = await import('@/app/api/admin/settings/ebook/test-flaresolverr/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/must start with http/);
  });

  it('returns error when FlareSolverr test throws', async () => {
    testFlareSolverrMock.mockRejectedValueOnce(new Error('flare down'));
    const request = { json: vi.fn().mockResolvedValue({ url: 'http://flare' }) };

    const { POST } = await import('@/app/api/admin/settings/ebook/test-flaresolverr/route');
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.message).toMatch(/flare down/);
  });
});


