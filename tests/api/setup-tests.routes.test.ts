/**
 * Component: Setup Validation API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const plexServiceMock = vi.hoisted(() => ({
  testConnection: vi.fn(),
  getLibraries: vi.fn(),
}));
const qbtMock = vi.hoisted(() => ({
  testConnectionWithCredentials: vi.fn(),
}));
const sabnzbdMock = vi.hoisted(() => ({
  testConnection: vi.fn(),
}));
const prowlarrMock = vi.hoisted(() => ({
  getIndexers: vi.fn(),
}));
const issuerMock = vi.hoisted(() => ({
  discover: vi.fn(),
}));
const fsMock = vi.hoisted(() => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
}));
const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@/lib/integrations/plex.service', () => ({
  getPlexService: () => plexServiceMock,
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

vi.mock('@/lib/integrations/prowlarr.service', () => ({
  ProwlarrService: class {
    constructor() {}
    getIndexers = prowlarrMock.getIndexers;
  },
}));

vi.mock('openid-client', () => ({
  Issuer: issuerMock,
}));

vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock, constants: { R_OK: 4 } }));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

describe('Setup test routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validates Plex connection and returns libraries', async () => {
    plexServiceMock.testConnection.mockResolvedValue({
      success: true,
      info: { platform: 'Plex', version: '1.0', machineIdentifier: 'machine' },
    });
    plexServiceMock.getLibraries.mockResolvedValue([{ id: '1', title: 'Books', type: 'book' }]);

    const { POST } = await import('@/app/api/setup/test-plex/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({ url: 'http://plex', token: 'token' }) } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.libraries[0].id).toBe('1');
  });

  it('returns 400 when Plex url or token is missing', async () => {
    const { POST } = await import('@/app/api/setup/test-plex/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({ url: 'http://plex' }) } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/URL and token/);
  });

  it('returns 400 when Plex connection fails', async () => {
    plexServiceMock.testConnection.mockResolvedValue({
      success: false,
      message: 'bad token',
    });

    const { POST } = await import('@/app/api/setup/test-plex/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({ url: 'http://plex', token: 'bad' }) } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/bad token/);
  });

  it('returns 400 when Plex info is missing', async () => {
    plexServiceMock.testConnection.mockResolvedValue({
      success: true,
      info: null,
      message: 'missing info',
    });

    const { POST } = await import('@/app/api/setup/test-plex/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({ url: 'http://plex', token: 'token' }) } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/missing info/);
  });

  it('returns 500 when Plex test throws', async () => {
    plexServiceMock.testConnection.mockRejectedValue(new Error('connection error'));

    const { POST } = await import('@/app/api/setup/test-plex/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({ url: 'http://plex', token: 'token' }) } as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/connection error/);
  });

  it('tests qBittorrent credentials', async () => {
    qbtMock.testConnectionWithCredentials.mockResolvedValue('4.0.0');

    const { POST } = await import('@/app/api/setup/test-download-client/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        type: 'qbittorrent',
        url: 'http://qbt',
        username: 'user',
        password: 'pass',
      }),
    } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.version).toBe('4.0.0');
  });

  it('rejects invalid download client type', async () => {
    const { POST } = await import('@/app/api/setup/test-download-client/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({ type: 'transmission', url: 'http://transmission' }),
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Invalid client type/);
  });

  it('rejects missing qBittorrent credentials', async () => {
    const { POST } = await import('@/app/api/setup/test-download-client/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({ type: 'qbittorrent', url: 'http://qbt' }),
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Username and password/);
  });

  it('tests SABnzbd connection', async () => {
    sabnzbdMock.testConnection.mockResolvedValue({ success: true, version: '3.0' });

    const { POST } = await import('@/app/api/setup/test-download-client/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        type: 'sabnzbd',
        url: 'http://sab',
        password: 'api-key',
      }),
    } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.version).toBe('3.0');
  });

  it('returns error when SABnzbd connection fails', async () => {
    sabnzbdMock.testConnection.mockResolvedValue({ success: false, error: 'bad key' });

    const { POST } = await import('@/app/api/setup/test-download-client/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        type: 'sabnzbd',
        url: 'http://sab',
        password: 'api-key',
      }),
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/bad key/);
  });

  it('tests Prowlarr indexers', async () => {
    prowlarrMock.getIndexers.mockResolvedValue([
      { id: 1, name: 'Indexer', protocol: 'torrent', enable: true, capabilities: {} },
      { id: 2, name: 'Disabled', protocol: 'torrent', enable: false, capabilities: {} },
    ]);

    const { POST } = await import('@/app/api/setup/test-prowlarr/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({ url: 'http://prowlarr', apiKey: 'key' }) } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.indexerCount).toBe(1);
  });

  it('validates OIDC issuer discovery', async () => {
    issuerMock.discover.mockResolvedValue({
      issuer: 'http://issuer',
      metadata: {
        authorization_endpoint: 'http://issuer/auth',
        token_endpoint: 'http://issuer/token',
        userinfo_endpoint: 'http://issuer/user',
        jwks_uri: 'http://issuer/jwks',
        scopes_supported: ['openid'],
        response_types_supported: ['code'],
      },
    });

    const { POST } = await import('@/app/api/setup/test-oidc/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        issuerUrl: 'http://issuer',
        clientId: 'client',
        clientSecret: 'secret',
      }),
    } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.issuer.authorizationEndpoint).toBe('http://issuer/auth');
  });

  it('returns error when OIDC fields are missing', async () => {
    const { POST } = await import('@/app/api/setup/test-oidc/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({ issuerUrl: 'http://issuer', clientId: 'client' }),
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/required/);
  });

  it('returns error when OIDC issuer URL is invalid', async () => {
    const { POST } = await import('@/app/api/setup/test-oidc/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        issuerUrl: 'not a url',
        clientId: 'client',
        clientSecret: 'secret',
      }),
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Invalid issuer URL/);
  });

  it('returns error when OIDC issuer metadata is incomplete', async () => {
    issuerMock.discover.mockResolvedValue({
      issuer: 'http://issuer',
      metadata: {
        token_endpoint: 'http://issuer/token',
        userinfo_endpoint: 'http://issuer/user',
      },
    });

    const { POST } = await import('@/app/api/setup/test-oidc/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        issuerUrl: 'http://issuer',
        clientId: 'client',
        clientSecret: 'secret',
      }),
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/missing required endpoints/);
  });

  it('returns friendly error when OIDC discovery fails to resolve host', async () => {
    issuerMock.discover.mockRejectedValue(new Error('getaddrinfo ENOTFOUND issuer'));

    const { POST } = await import('@/app/api/setup/test-oidc/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        issuerUrl: 'http://issuer',
        clientId: 'client',
        clientSecret: 'secret',
      }),
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/Cannot reach OIDC provider/);
  });

  it('validates paths are writable', async () => {
    fsMock.access.mockRejectedValueOnce(new Error('missing'));
    fsMock.mkdir.mockResolvedValueOnce(undefined);
    fsMock.writeFile.mockResolvedValueOnce(undefined);
    fsMock.unlink.mockResolvedValueOnce(undefined);

    fsMock.access.mockResolvedValueOnce(undefined);
    fsMock.writeFile.mockResolvedValueOnce(undefined);
    fsMock.unlink.mockResolvedValueOnce(undefined);

    const { POST } = await import('@/app/api/setup/test-paths/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({ downloadDir: '/downloads', mediaDir: '/media' }),
    } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.downloadDir.valid).toBe(true);
  });

  it('validates path template when provided', async () => {
    fsMock.access.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    const { POST } = await import('@/app/api/setup/test-paths/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        downloadDir: '/downloads',
        mediaDir: '/media',
        audiobookPathTemplate: '{author}/{title} ({year})',
      }),
    } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.template).toBeDefined();
    expect(payload.template.isValid).toBe(true);
    expect(payload.template.previewPaths).toHaveLength(3);
  });

  it('returns error for invalid path template', async () => {
    fsMock.access.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    const { POST } = await import('@/app/api/setup/test-paths/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        downloadDir: '/downloads',
        mediaDir: '/media',
        audiobookPathTemplate: '{author}/{invalid_var}',
      }),
    } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.template).toBeDefined();
    expect(payload.template.isValid).toBe(false);
    expect(payload.template.error).toContain('Unknown variable');
    expect(payload.template.previewPaths).toBeUndefined();
  });

  it('returns error when paths validation fails', async () => {
    fsMock.access.mockRejectedValue(new Error('missing'));
    fsMock.mkdir.mockRejectedValue(new Error('no permissions'));

    const { POST } = await import('@/app/api/setup/test-paths/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        downloadDir: '/bad/downloads',
        mediaDir: '/bad/media',
      }),
    } as any);
    const payload = await response.json();

    expect(payload.success).toBe(false);
    expect(payload.downloadDir.valid).toBe(false);
    expect(payload.mediaDir.valid).toBe(false);
    expect(payload.error).toBeDefined();
  });

  it('validates template with absolute path and returns error', async () => {
    fsMock.access.mockResolvedValue(undefined);
    fsMock.writeFile.mockResolvedValue(undefined);
    fsMock.unlink.mockResolvedValue(undefined);

    const { POST } = await import('@/app/api/setup/test-paths/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({
        downloadDir: '/downloads',
        mediaDir: '/media',
        audiobookPathTemplate: '/absolute/{author}/{title}',
      }),
    } as any);
    const payload = await response.json();

    expect(payload.template).toBeDefined();
    expect(payload.template.isValid).toBe(false);
    expect(payload.template.error).toContain('absolute');
  });

  it('tests Audiobookshelf connection with saved token', async () => {
    configServiceMock.get.mockResolvedValueOnce('token');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ libraries: [{ id: '1', name: 'Lib', mediaType: 'book', stats: { totalItems: 10 } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('@/app/api/setup/test-abs/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({ serverUrl: 'http://abs', apiToken: '********' }),
    } as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.libraries[0].id).toBe('1');
  });

  it('returns error when Audiobookshelf server URL is missing', async () => {
    const { POST } = await import('@/app/api/setup/test-abs/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({}) } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Server URL/);
  });

  it('returns error when saved Audiobookshelf token is missing', async () => {
    configServiceMock.get.mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/setup/test-abs/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({ serverUrl: 'http://abs', apiToken: '' }),
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/API token is required/);
  });

  it('returns error when Audiobookshelf connection fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('@/app/api/setup/test-abs/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({ serverUrl: 'http://abs', apiToken: 'token' }),
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Connection failed/);
  });

  it('returns error when Audiobookshelf response is missing libraries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('@/app/api/setup/test-abs/route');
    const response = await POST({
      json: vi.fn().mockResolvedValue({ serverUrl: 'http://abs', apiToken: 'token' }),
    } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Invalid response/);
  });
});


