/**
 * Component: Local Auth API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const localAuthProviderMock = {
  handleCallback: vi.fn(),
  register: vi.fn(),
};

vi.mock('@/lib/services/auth/LocalAuthProvider', () => ({
  LocalAuthProvider: class {
    handleCallback = localAuthProviderMock.handleCallback;
    register = localAuthProviderMock.register;
  },
}));

const makeRequest = (body: any, headers?: Record<string, string>) => ({
  json: vi.fn().mockResolvedValue(body),
  headers: {
    get: (key: string) => headers?.[key.toLowerCase()] || null,
  },
});

describe('Local auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DISABLE_LOCAL_LOGIN;
  });

  it('rejects login when local auth is disabled', async () => {
    process.env.DISABLE_LOCAL_LOGIN = 'true';
    const { POST } = await import('@/app/api/auth/local/login/route');

    const response = await POST(makeRequest({ username: 'user', password: 'pass' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Local login is disabled');
  });

  it('rejects login when username or password missing', async () => {
    const { POST } = await import('@/app/api/auth/local/login/route');

    const response = await POST(makeRequest({ username: 'user' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Username and password are required');
  });

  it('logs in successfully with local credentials', async () => {
    localAuthProviderMock.handleCallback.mockResolvedValue({
      success: true,
      user: { id: 'u1' },
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
    });
    const { POST } = await import('@/app/api/auth/local/login/route');

    const response = await POST(makeRequest({ username: 'user', password: 'pass' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.accessToken).toBe('access');
  });

  it('returns pending approval for local login', async () => {
    localAuthProviderMock.handleCallback.mockResolvedValue({
      success: false,
      requiresApproval: true,
    });
    const { POST } = await import('@/app/api/auth/local/login/route');

    const response = await POST(makeRequest({ username: 'user', password: 'pass' }) as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pendingApproval).toBe(true);
  });

  it('registers a local user and returns tokens', async () => {
    localAuthProviderMock.register.mockResolvedValue({
      success: true,
      user: { id: 'u2' },
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
    });
    const { POST } = await import('@/app/api/auth/register/route');

    const request = makeRequest({ username: 'user', password: 'pass' }, { 'x-forwarded-for': 'ip-1' });
    const response = await POST(request as any);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.refreshToken).toBe('refresh');
  });

  it('rate limits repeated registration attempts by IP', async () => {
    localAuthProviderMock.register.mockResolvedValue({
      success: true,
      user: { id: 'u3' },
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
    });
    const { POST } = await import('@/app/api/auth/register/route');

    const request = makeRequest({ username: 'user', password: 'pass' }, { 'x-forwarded-for': 'ip-2' });
    for (let i = 0; i < 5; i += 1) {
      const response = await POST(request as any);
      expect(response.status).toBe(200);
    }

    const blocked = await POST(request as any);
    const payload = await blocked.json();

    expect(blocked.status).toBe(429);
    expect(payload.error).toMatch(/Too many registration attempts/);
  });

  describe('request size limit (64 KB)', () => {
    const bigBody = () => JSON.stringify({ username: 'user', password: 'p'.repeat(100 * 1024) });
    const realRequest = async (path: string, ip: string) => {
      const { NextRequest } = await import('next/server');
      return new NextRequest(`http://localhost${path}`, {
        method: 'POST',
        body: bigBody(),
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      });
    };

    it('returns 413 for an oversized login body without checking credentials', async () => {
      const { POST } = await import('@/app/api/auth/local/login/route');

      const response = await POST(await realRequest('/api/auth/local/login', 'ip-3'));

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: 'PayloadTooLarge', message: 'Request body is larger than 64 KB' });
      expect(localAuthProviderMock.handleCallback).not.toHaveBeenCalled();
    });

    it('returns 413 for an oversized registration body without registering', async () => {
      const { POST } = await import('@/app/api/auth/register/route');

      const response = await POST(await realRequest('/api/auth/register', 'ip-4'));

      expect(response.status).toBe(413);
      expect(localAuthProviderMock.register).not.toHaveBeenCalled();
    });
  });
});


