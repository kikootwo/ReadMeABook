/**
 * Component: Setup Route Guard Tests
 * Documentation: documentation/testing.md
 *
 * Verifies that setup API endpoints are properly guarded after setup is complete.
 * - Setup-only endpoints (complete, test-download-client, test-plex, test-prowlarr)
 *   return 403 unconditionally after setup.
 * - Shared endpoints (test-paths, test-abs, test-oidc) require admin auth after setup.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyAccessTokenMock = vi.hoisted(() => vi.fn());

const prismaMock = vi.hoisted(() => ({
  configuration: {
    findUnique: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

// Mock all external dependencies that setup routes import
vi.mock('@/lib/integrations/plex.service', () => ({
  getPlexService: () => ({
    testConnection: vi.fn(),
    getLibraries: vi.fn(),
  }),
}));

vi.mock('@/lib/integrations/prowlarr.service', () => ({
  ProwlarrService: class {
    constructor() {}
    getIndexers = vi.fn();
  },
}));

vi.mock('openid-client', () => ({
  Issuer: { discover: vi.fn() },
}));

vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
  },
  access: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  constants: { R_OK: 4 },
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ get: vi.fn() }),
}));

vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => ({ testConnection: vi.fn() }),
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ encrypt: vi.fn((v: string) => `enc-${v}`) }),
}));

vi.mock('bcrypt', () => ({
  default: { hash: vi.fn() },
  hash: vi.fn(),
}));

vi.mock('@/lib/utils/jwt', () => ({
  generateAccessToken: vi.fn(() => 'token'),
  generateRefreshToken: vi.fn(() => 'token'),
  verifyAccessToken: verifyAccessTokenMock,
}));

function mockSetupComplete() {
  prismaMock.configuration.findUnique.mockResolvedValue({ key: 'setup_completed', value: 'true' });
}

function makeRequest(body: Record<string, unknown> = {}, authToken?: string) {
  const headers = new Map<string, string>();
  if (authToken) {
    headers.set('authorization', `Bearer ${authToken}`);
  }
  return {
    json: vi.fn().mockResolvedValue(body),
    nextUrl: { pathname: '/api/setup/test' },
    headers: {
      get: (key: string) => headers.get(key) ?? null,
    },
  } as any;
}

describe('Setup route guard - setup-only endpoints (requireSetupIncomplete)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetupComplete();
  });

  it('POST /api/setup/complete returns 403 when setup is already complete', async () => {
    const { POST } = await import('@/app/api/setup/complete/route');
    const response = await POST(makeRequest({ backendMode: 'plex' }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
    expect(payload.message).toMatch(/Setup has already been completed/);
  });

  it('POST /api/setup/test-download-client returns 403 when setup is already complete', async () => {
    const { POST } = await import('@/app/api/setup/test-download-client/route');
    const response = await POST(makeRequest({ type: 'qbittorrent', url: 'http://qbt' }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('POST /api/setup/test-plex returns 403 when setup is already complete', async () => {
    const { POST } = await import('@/app/api/setup/test-plex/route');
    const response = await POST(makeRequest({ url: 'http://plex', token: 'token' }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('POST /api/setup/test-prowlarr returns 403 when setup is already complete', async () => {
    const { POST } = await import('@/app/api/setup/test-prowlarr/route');
    const response = await POST(makeRequest({ url: 'http://prowlarr', apiKey: 'key' }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('allows requests through when setup is not yet complete', async () => {
    prismaMock.configuration.findUnique.mockResolvedValue(null);

    const { POST } = await import('@/app/api/setup/test-download-client/route');
    const response = await POST(makeRequest({ type: 'qbittorrent', url: 'http://qbt' }));

    expect(response.status).not.toBe(403);
  });

  it('fails closed with 503 (handler not run) when the setup state cannot be read', async () => {
    prismaMock.configuration.findUnique.mockRejectedValue(new Error('DB not ready'));

    const { POST } = await import('@/app/api/setup/test-download-client/route');
    const response = await POST(makeRequest({ type: 'qbittorrent', url: 'http://qbt' }));
    const payload = await response.json();

    expect(response.status).toBe(503);
    // The guard's own body, not the route's (the route answers success/error for a connection test)
    expect(payload.error).toBe('ServiceUnavailable');
    expect(payload).not.toHaveProperty('success');
  });
});

describe('Setup route guard - shared endpoints (requireSetupIncompleteOrAdmin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetupComplete();
  });

  it('POST /api/setup/test-paths returns 401 when setup is complete and no auth', async () => {
    const { POST } = await import('@/app/api/setup/test-paths/route');
    const response = await POST(makeRequest({ downloadDir: '/downloads', mediaDir: '/media' }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('POST /api/setup/test-abs returns 401 when setup is complete and no auth', async () => {
    const { POST } = await import('@/app/api/setup/test-abs/route');
    const response = await POST(makeRequest({ serverUrl: 'http://abs', apiToken: 'token' }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('POST /api/setup/test-oidc returns 401 when setup is complete and no auth', async () => {
    const { POST } = await import('@/app/api/setup/test-oidc/route');
    const response = await POST(makeRequest({
      issuerUrl: 'http://issuer',
      clientId: 'client',
      clientSecret: 'secret',
    }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('POST /api/setup/test-paths returns 403 when setup is complete and user is not admin', async () => {
    verifyAccessTokenMock.mockReturnValue({ sub: 'user-1', role: 'user' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user' });

    const { POST } = await import('@/app/api/setup/test-paths/route');
    const response = await POST(makeRequest({ downloadDir: '/downloads', mediaDir: '/media' }, 'valid-token'));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('POST /api/setup/test-paths allows admin access after setup is complete', async () => {
    verifyAccessTokenMock.mockReturnValue({ sub: 'admin-1', role: 'admin' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin' });

    const { POST } = await import('@/app/api/setup/test-paths/route');
    const response = await POST(makeRequest({ downloadDir: '/downloads', mediaDir: '/media' }, 'admin-token'));

    // Should reach the handler (not 401 or 403)
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });

  it('allows unauthenticated access during setup for shared endpoints', async () => {
    prismaMock.configuration.findUnique.mockResolvedValue(null);

    const { POST } = await import('@/app/api/setup/test-paths/route');
    const response = await POST(makeRequest({ downloadDir: '/downloads', mediaDir: '/media' }));

    // Should reach the handler (not 401 or 403) — setup in progress
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });
});
