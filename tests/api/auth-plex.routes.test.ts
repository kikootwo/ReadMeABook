/**
 * Component: Plex Auth API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const plexServiceMock = vi.hoisted(() => ({
  requestPin: vi.fn(),
  getOAuthUrl: vi.fn(),
  checkPin: vi.fn(),
  getUserInfo: vi.fn(),
  verifyServerAccess: vi.fn(),
  getHomeUsers: vi.fn(),
  switchHomeUser: vi.fn(),
}));
const encryptionServiceMock = vi.hoisted(() => ({
  encrypt: vi.fn((value: string) => `enc-${value}`),
}));
const configServiceMock = vi.hoisted(() => ({
  getPlexConfig: vi.fn(),
}));
const authTokenCacheMock = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}));
const generateAccessTokenMock = vi.hoisted(() => vi.fn(() => 'access-token'));
const generateRefreshTokenMock = vi.hoisted(() => vi.fn(() => 'refresh-token'));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/integrations/plex.service', () => ({
  getPlexService: () => plexServiceMock,
}));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => encryptionServiceMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

vi.mock('@/lib/services/auth-token-cache.service', () => ({
  getAuthTokenCache: () => authTokenCacheMock,
}));

vi.mock('@/lib/utils/jwt', () => ({
  generateAccessToken: generateAccessTokenMock,
  generateRefreshToken: generateRefreshTokenMock,
}));

const makeRequest = (url: string, headers?: Record<string, string>) => ({
  nextUrl: new URL(url),
  headers: {
    get: (key: string) => headers?.[key.toLowerCase()] || null,
  },
  json: vi.fn(),
});

describe('Plex auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initiates Plex login and returns auth URL', async () => {
    plexServiceMock.requestPin.mockResolvedValue({ id: 1, code: 'code-1' });
    plexServiceMock.getOAuthUrl.mockReturnValue('http://plex/auth');

    const { POST } = await import('@/app/api/auth/plex/login/route');
    const response = await POST(makeRequest('http://localhost/api/auth/plex/login', { origin: 'http://app' }) as any);
    const payload = await response.json();

    expect(payload.authUrl).toBe('http://plex/auth');
    expect(plexServiceMock.getOAuthUrl).toHaveBeenCalledWith('code-1', 1, 'http://app/api/auth/plex/callback');
  });

  it('returns 400 when pinId is missing', async () => {
    const { GET } = await import('@/app/api/auth/plex/callback/route');

    const response = await GET(makeRequest('http://localhost/api/auth/plex/callback') as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('returns 202 when waiting for authorization', async () => {
    plexServiceMock.checkPin.mockResolvedValue(null);

    const { GET } = await import('@/app/api/auth/plex/callback/route');
    const response = await GET(makeRequest('http://localhost/api/auth/plex/callback?pinId=1') as any);
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload.authorized).toBe(false);
  });

  it('denies access when Plex server is not configured', async () => {
    plexServiceMock.checkPin.mockResolvedValue('token');
    plexServiceMock.getUserInfo.mockResolvedValue({ id: 'plex-1', username: 'user' });
    configServiceMock.getPlexConfig.mockResolvedValue({ serverUrl: null, authToken: null });

    const { GET } = await import('@/app/api/auth/plex/callback/route');
    const response = await GET(makeRequest('http://localhost/api/auth/plex/callback?pinId=2') as any);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toBe('ConfigurationError');
  });

  it('denies access when machine identifier is missing', async () => {
    plexServiceMock.checkPin.mockResolvedValue('token');
    plexServiceMock.getUserInfo.mockResolvedValue({ id: 'plex-1', username: 'user' });
    configServiceMock.getPlexConfig.mockResolvedValue({
      serverUrl: 'http://plex',
      authToken: 'token',
      machineIdentifier: null,
    });

    const { GET } = await import('@/app/api/auth/plex/callback/route');
    const response = await GET(makeRequest('http://localhost/api/auth/plex/callback?pinId=2') as any);
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toBe('ConfigurationError');
  });

  it('rejects when user lacks server access', async () => {
    plexServiceMock.checkPin.mockResolvedValue('token');
    plexServiceMock.getUserInfo.mockResolvedValue({ id: 'plex-1', username: 'user' });
    configServiceMock.getPlexConfig.mockResolvedValue({
      serverUrl: 'http://plex',
      authToken: 'token',
      machineIdentifier: 'machine',
    });
    plexServiceMock.verifyServerAccess.mockResolvedValue(false);

    const { GET } = await import('@/app/api/auth/plex/callback/route');
    const response = await GET(makeRequest('http://localhost/api/auth/plex/callback?pinId=2') as any);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('AccessDenied');
  });

  it('returns errors when Plex user info is incomplete', async () => {
    plexServiceMock.checkPin.mockResolvedValue('token');
    plexServiceMock.getUserInfo.mockResolvedValue({ id: 'plex-1', username: '' });

    const { GET } = await import('@/app/api/auth/plex/callback/route');
    const response = await GET(makeRequest('http://localhost/api/auth/plex/callback?pinId=2') as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('OAuthError');
    expect(payload.details).toContain('Username is missing');
  });

  it('returns profile selection info when multiple home users exist', async () => {
    plexServiceMock.checkPin.mockResolvedValue('token');
    plexServiceMock.getUserInfo.mockResolvedValue({ id: 'plex-1', username: 'user' });
    configServiceMock.getPlexConfig.mockResolvedValue({
      serverUrl: 'http://plex',
      authToken: 'token',
      machineIdentifier: 'machine',
    });
    plexServiceMock.verifyServerAccess.mockResolvedValue(true);
    plexServiceMock.getHomeUsers.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const { GET } = await import('@/app/api/auth/plex/callback/route');
    const response = await GET(makeRequest('http://localhost/api/auth/plex/callback?pinId=3', { accept: 'application/json' }) as any);
    const payload = await response.json();

    expect(payload.requiresProfileSelection).toBe(true);
    expect(payload.homeUsers).toBe(2);
  });

  it('returns HTML redirect for browser profile selection', async () => {
    plexServiceMock.checkPin.mockResolvedValue('token');
    plexServiceMock.getUserInfo.mockResolvedValue({ id: 'plex-1', username: 'user' });
    configServiceMock.getPlexConfig.mockResolvedValue({
      serverUrl: 'http://plex',
      authToken: 'token',
      machineIdentifier: 'machine',
    });
    plexServiceMock.verifyServerAccess.mockResolvedValue(true);
    plexServiceMock.getHomeUsers.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const { GET } = await import('@/app/api/auth/plex/callback/route');
    const response = await GET(
      makeRequest('http://localhost/api/auth/plex/callback?pinId=3', {
        accept: 'text/html',
        host: 'example.com',
        'x-forwarded-proto': 'https',
      }) as any
    );
    const html = await response.text();

    expect(response.headers.get('content-type')).toContain('text/html');
    // Token is now stored server-side, not in sessionStorage
    expect(html).toContain('token is stored server-side');
    expect(html).toContain('https://example.com/auth/select-profile?pinId=3');
    expect(authTokenCacheMock.set).toHaveBeenCalledWith('3', 'token');
  });

  it('returns tokens for successful Plex auth', async () => {
    plexServiceMock.checkPin.mockResolvedValue('token');
    plexServiceMock.getUserInfo.mockResolvedValue({ id: 'plex-1', username: 'user' });
    configServiceMock.getPlexConfig.mockResolvedValue({
      serverUrl: 'http://plex',
      authToken: 'token',
      machineIdentifier: 'machine',
    });
    plexServiceMock.verifyServerAccess.mockResolvedValue(true);
    plexServiceMock.getHomeUsers.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.upsert.mockResolvedValue({
      id: 'user-1',
      plexId: 'plex-1',
      plexUsername: 'user',
      plexEmail: null,
      role: 'admin',
      avatarUrl: null,
    });

    const { GET } = await import('@/app/api/auth/plex/callback/route');
    const response = await GET(makeRequest('http://localhost/api/auth/plex/callback?pinId=4', { accept: 'application/json' }) as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.accessToken).toBe('access-token');
  });

  it('returns HTML redirect with cookies for browser auth', async () => {
    plexServiceMock.checkPin.mockResolvedValue('token');
    plexServiceMock.getUserInfo.mockResolvedValue({
      id: 'plex-1',
      username: 'user',
      email: 'user@example.com',
      thumb: '/t',
    });
    configServiceMock.getPlexConfig.mockResolvedValue({
      serverUrl: 'http://plex',
      authToken: 'token',
      machineIdentifier: 'machine',
    });
    plexServiceMock.verifyServerAccess.mockResolvedValue(true);
    plexServiceMock.getHomeUsers.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.upsert.mockResolvedValue({
      id: 'user-1',
      plexId: 'plex-1',
      plexUsername: 'user',
      plexEmail: 'user@example.com',
      role: 'user',
      avatarUrl: '/t',
    });

    const { GET } = await import('@/app/api/auth/plex/callback/route');
    const response = await GET(
      makeRequest('http://localhost/api/auth/plex/callback?pinId=4', {
        accept: 'text/html',
        host: 'example.com',
        'x-forwarded-proto': 'https',
      }) as any
    );
    const html = await response.text();

    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.cookies.get('accessToken')?.value).toBe('access-token');
    expect(response.cookies.get('refreshToken')?.value).toBe('refresh-token');
    expect(html).toContain('#authData=');
  });

  it('returns Plex home users when pinId is provided', async () => {
    authTokenCacheMock.get.mockReturnValue('cached-token');
    plexServiceMock.getHomeUsers.mockResolvedValue([{ id: 1 }]);

    const { GET } = await import('@/app/api/auth/plex/home-users/route');
    const response = await GET(makeRequest('http://localhost/api/auth/plex/home-users', { 'x-plex-pin-id': '123' }) as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.users).toHaveLength(1);
    expect(authTokenCacheMock.get).toHaveBeenCalledWith('123');
  });

  it('rejects Plex home users when pinId is missing', async () => {
    const { GET } = await import('@/app/api/auth/plex/home-users/route');
    const response = await GET(makeRequest('http://localhost/api/auth/plex/home-users') as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns 401 when token not found in cache', async () => {
    authTokenCacheMock.get.mockReturnValue(null);

    const { GET } = await import('@/app/api/auth/plex/home-users/route');
    const response = await GET(makeRequest('http://localhost/api/auth/plex/home-users', { 'x-plex-pin-id': '123' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('SessionExpired');
  });

  it('returns 500 when Plex home users fetch fails', async () => {
    authTokenCacheMock.get.mockReturnValue('cached-token');
    plexServiceMock.getHomeUsers.mockRejectedValue(new Error('boom'));

    const { GET } = await import('@/app/api/auth/plex/home-users/route');
    const response = await GET(makeRequest('http://localhost/api/auth/plex/home-users', { 'x-plex-pin-id': '123' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('ServerError');
  });

  it('rejects profile switch without pinId', async () => {
    const { POST } = await import('@/app/api/auth/plex/switch-profile/route');
    const request = makeRequest('http://localhost/api/auth/plex/switch-profile');
    request.json.mockResolvedValue({ userId: 'home-1' });

    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('rejects profile switch when token not found in cache', async () => {
    authTokenCacheMock.get.mockReturnValue(null);

    const { POST } = await import('@/app/api/auth/plex/switch-profile/route');
    const request = makeRequest('http://localhost/api/auth/plex/switch-profile');
    request.json.mockResolvedValue({ userId: 'home-1', pinId: '123' });

    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('SessionExpired');
  });

  it('rejects profile switch when userId is missing', async () => {
    authTokenCacheMock.get.mockReturnValue('cached-token');

    const { POST } = await import('@/app/api/auth/plex/switch-profile/route');
    const request = makeRequest('http://localhost/api/auth/plex/switch-profile');
    request.json.mockResolvedValue({ pinId: '123' });

    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('returns 401 for invalid profile PIN', async () => {
    authTokenCacheMock.get.mockReturnValue('cached-token');
    plexServiceMock.getHomeUsers.mockResolvedValue([{ id: 'home-1', uuid: 'uuid1' }]);
    plexServiceMock.switchHomeUser.mockRejectedValue(new Error('Invalid PIN'));

    const { POST } = await import('@/app/api/auth/plex/switch-profile/route');
    const request = makeRequest('http://localhost/api/auth/plex/switch-profile');
    request.json.mockResolvedValue({ userId: 'home-1', pin: '0000', pinId: '123' });

    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('InvalidPIN');
  });

  it('switches Plex profile using the Plex Home user entry for identity', async () => {
    authTokenCacheMock.get.mockReturnValue('cached-token');
    plexServiceMock.getHomeUsers.mockResolvedValue([
      { id: 'home-1', uuid: 'uuid-1', title: 'Profile', friendlyName: 'Profile', email: '', thumb: '' },
    ]);
    plexServiceMock.switchHomeUser.mockResolvedValue('profile-token');
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.upsert.mockResolvedValue({
      id: 'user-2',
      plexId: 'uuid-1',
      plexUsername: 'Profile',
      plexEmail: null,
      role: 'user',
      avatarUrl: null,
    });

    const { POST } = await import('@/app/api/auth/plex/switch-profile/route');
    const request = makeRequest('http://localhost/api/auth/plex/switch-profile');
    request.json.mockResolvedValue({
      userId: 'home-1',
      pin: '1234',
      pinId: '123',
      profileInfo: { uuid: 'uuid-1', friendlyName: 'Profile' },
    });

    const response = await POST(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.accessToken).toBe('access-token');
    expect(authTokenCacheMock.delete).toHaveBeenCalledWith('123');
    expect(prismaMock.user.upsert.mock.calls[0][0].where).toEqual({ plexId: 'uuid-1' });
  });

  it('switches Plex profile using getUserInfo fallback', async () => {
    authTokenCacheMock.get.mockReturnValue('cached-token');
    plexServiceMock.getHomeUsers.mockResolvedValue([{ id: 'home-2', uuid: 'uuid2' }]);
    plexServiceMock.switchHomeUser.mockResolvedValue('profile-token');
    plexServiceMock.getUserInfo.mockResolvedValue({
      id: 'plex-3',
      username: 'Fallback',
      email: 'user@example.com',
      thumb: '/avatar',
    });
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.upsert.mockResolvedValue({
      id: 'user-3',
      plexId: 'plex-3',
      plexUsername: 'Fallback',
      plexEmail: 'user@example.com',
      role: 'admin',
      avatarUrl: '/avatar',
    });

    const { POST } = await import('@/app/api/auth/plex/switch-profile/route');
    const request = makeRequest('http://localhost/api/auth/plex/switch-profile');
    request.json.mockResolvedValue({ userId: 'home-2', pin: '1234', pinId: '123' });

    const response = await POST(request as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.user.plexId).toBe('plex-3');
    expect(payload.user.role).toBe('admin');
  });

  it('returns 500 when profile info lookup fails', async () => {
    authTokenCacheMock.get.mockReturnValue('cached-token');
    plexServiceMock.getHomeUsers.mockResolvedValue([{ id: 'home-2', uuid: 'uuid2' }]);
    plexServiceMock.switchHomeUser.mockResolvedValue('profile-token');
    plexServiceMock.getUserInfo.mockResolvedValue({ id: null });

    const { POST } = await import('@/app/api/auth/plex/switch-profile/route');
    const request = makeRequest('http://localhost/api/auth/plex/switch-profile');
    request.json.mockResolvedValue({ userId: 'home-2', pin: '1234', pinId: '123' });

    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('ServerError');
  });
});


