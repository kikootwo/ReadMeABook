/**
 * Component: Token Login Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const generateAccessTokenMock = vi.hoisted(() => vi.fn());
const generateRefreshTokenMock = vi.hoisted(() => vi.fn());
const checkTokenLoginRateLimitMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/utils/jwt', () => ({
  generateAccessToken: generateAccessTokenMock,
  generateRefreshToken: generateRefreshTokenMock,
}));

vi.mock('@/lib/utils/authRateLimit', () => ({
  checkTokenLoginRateLimit: checkTokenLoginRateLimitMock,
}));

function makeRequest(body: Record<string, unknown>, ip = '127.0.0.1') {
  return {
    headers: { get: vi.fn().mockReturnValue(ip) },
    json: vi.fn().mockResolvedValue(body),
  };
}

describe('POST /api/auth/token/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateAccessTokenMock.mockReturnValue('access-token');
    generateRefreshTokenMock.mockReturnValue('refresh-token');
    checkTokenLoginRateLimitMock.mockReturnValue({ allowed: true, retryAfterSeconds: 900 });
  });

  it('authenticates user with a valid token', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 'u1',
      plexId: 'plex-1',
      plexUsername: 'testuser',
      plexEmail: 'test@example.com',
      avatarUrl: null,
      role: 'user',
    });
    prismaMock.user.update.mockResolvedValueOnce({});

    const { POST } = await import('@/app/api/auth/token/login/route');
    const response = await POST(makeRequest({ token: 'rmab_valid_token' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.accessToken).toBe('access-token');
    expect(payload.refreshToken).toBe('refresh-token');
    expect(payload.user.username).toBe('testuser');
    expect(payload.user.email).toBe('test@example.com');
  });

  it('returns 400 when token parameter is missing', async () => {
    const { POST } = await import('@/app/api/auth/token/login/route');
    const response = await POST(makeRequest({}) as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/Missing token/);
  });

  it('returns 401 when token is invalid or user not found', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(null);

    const { POST } = await import('@/app/api/auth/token/login/route');
    const response = await POST(makeRequest({ token: 'rmab_invalid' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toMatch(/Invalid token/);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    checkTokenLoginRateLimitMock.mockReturnValue({ allowed: false, retryAfterSeconds: 600 });

    const { POST } = await import('@/app/api/auth/token/login/route');
    const response = await POST(makeRequest({ token: 'rmab_any' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(429);
    expect(payload.error).toMatch(/Too many login attempts/);
    expect(response.headers.get('Retry-After')).toBe('600');
  });
});
