/**
 * Component: Auth Misc API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const verifyRefreshTokenMock = vi.hoisted(() => vi.fn());
const generateAccessTokenMock = vi.hoisted(() => vi.fn());
const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
}));

vi.mock('@/lib/utils/jwt', () => ({
  verifyRefreshToken: verifyRefreshTokenMock,
  generateAccessToken: generateAccessTokenMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  ConfigurationService: class {
    get = configServiceMock.get;
  },
}));

describe('Auth misc routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = {
      user: { id: 'user-1', role: 'user' },
    };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    delete process.env.DISABLE_LOCAL_LOGIN;
  });

  it('logs out successfully', async () => {
    const { POST } = await import('@/app/api/auth/logout/route');

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
  });

  it('returns current user details with local admin flag', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      plexId: 'local-admin',
      plexUsername: 'admin',
      plexEmail: 'admin@example.com',
      role: 'admin',
      isSetupAdmin: true,
      avatarUrl: null,
      authProvider: 'local',
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    const { GET } = await import('@/app/api/auth/me/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.user.isLocalAdmin).toBe(true);
    expect(payload.user.username).toBe('admin');
  });

  it('refreshes access token when refresh token is valid', async () => {
    verifyRefreshTokenMock.mockReturnValue({ sub: 'user-1' });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      plexId: 'plex-1',
      plexUsername: 'user',
      role: 'user',
    });
    generateAccessTokenMock.mockReturnValue('access-token');

    const { POST } = await import('@/app/api/auth/refresh/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({ refreshToken: 'refresh' }) } as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.accessToken).toBe('access-token');
  });

  it('returns 400 when refresh token is missing', async () => {
    const { POST } = await import('@/app/api/auth/refresh/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({}) } as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('ValidationError');
  });

  it('returns 401 when refresh token is invalid', async () => {
    verifyRefreshTokenMock.mockReturnValue(null);
    const { POST } = await import('@/app/api/auth/refresh/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({ refreshToken: 'bad' }) } as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns 401 when user is not found for refresh token', async () => {
    verifyRefreshTokenMock.mockReturnValue({ sub: 'user-missing' });
    prismaMock.user.findUnique.mockResolvedValue(null);

    const { POST } = await import('@/app/api/auth/refresh/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({ refreshToken: 'refresh' }) } as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('returns 500 when refresh token verification throws', async () => {
    verifyRefreshTokenMock.mockImplementation(() => {
      throw new Error('bad token');
    });

    const { POST } = await import('@/app/api/auth/refresh/route');
    const response = await POST({ json: vi.fn().mockResolvedValue({ refreshToken: 'refresh' }) } as any);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe('RefreshError');
  });

  it('returns provider info for audiobookshelf mode', async () => {
    configServiceMock.get
      .mockResolvedValueOnce('audiobookshelf')
      .mockResolvedValueOnce('prowlarr')
      .mockResolvedValueOnce('http://prowlarr')
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('MyOIDC');

    prismaMock.user.count.mockResolvedValueOnce(1);

    const { GET } = await import('@/app/api/auth/providers/route');
    const response = await GET();
    const payload = await response.json();

    expect(payload.backendMode).toBe('audiobookshelf');
    expect(payload.providers).toContain('oidc');
    expect(payload.registrationEnabled).toBe(true);
    expect(payload.oidcProviderName).toBe('MyOIDC');
  });
});


