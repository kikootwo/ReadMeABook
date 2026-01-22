/**
 * Component: OIDC Auth API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const authProviderMock = vi.hoisted(() => ({
  initiateLogin: vi.fn(),
  handleCallback: vi.fn(),
}));
const getBaseUrlMock = vi.hoisted(() => vi.fn(() => 'http://app'));

vi.mock('@/lib/services/auth', () => ({
  getAuthProvider: async () => authProviderMock,
}));

vi.mock('@/lib/utils/url', () => ({
  getBaseUrl: getBaseUrlMock,
}));

const makeRequest = (url: string) => ({
  nextUrl: new URL(url),
});

describe('OIDC auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to provider on login', async () => {
    authProviderMock.initiateLogin.mockResolvedValue({ redirectUrl: 'http://oidc/login' });
    const { GET } = await import('@/app/api/auth/oidc/login/route');

    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://oidc/login');
  });

  it('returns error when OIDC login URL is missing', async () => {
    authProviderMock.initiateLogin.mockResolvedValue({});
    const { GET } = await import('@/app/api/auth/oidc/login/route');

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/Failed to generate authorization URL/);
  });

  it('redirects to login when OIDC login initiation fails', async () => {
    authProviderMock.initiateLogin.mockRejectedValue(new Error('boom'));
    const { GET } = await import('@/app/api/auth/oidc/login/route');

    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login?error=');
  });

  it('redirects to login on missing code/state', async () => {
    const { GET } = await import('@/app/api/auth/oidc/callback/route');

    const response = await GET(makeRequest('http://app/api/auth/oidc/callback') as any);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login?error=');
  });

  it('redirects with pending approval when required', async () => {
    authProviderMock.handleCallback.mockResolvedValue({ success: false, requiresApproval: true });
    const { GET } = await import('@/app/api/auth/oidc/callback/route');

    const response = await GET(makeRequest('http://app/api/auth/oidc/callback?code=abc&state=def') as any);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://app/login?pending=approval');
  });

  it('returns HTML response for successful callback', async () => {
    authProviderMock.handleCallback.mockResolvedValue({
      success: true,
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
      user: { id: 'u1', username: 'user', email: 'a@b.com', avatarUrl: null, isAdmin: false },
      isFirstLogin: false,
    });

    const { GET } = await import('@/app/api/auth/oidc/callback/route');
    const response = await GET(makeRequest('http://app/api/auth/oidc/callback?code=abc&state=def') as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });
});


