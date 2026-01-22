/**
 * Component: API Utility Tests
 * Documentation: documentation/frontend/routing-auth.md
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isTokenExpiredMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/jwt-client', () => ({
  isTokenExpired: isTokenExpiredMock,
}));

describe('fetchWithAuth', () => {
  let locationStub: { href: string; pathname: string };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    isTokenExpiredMock.mockReturnValue(false);
    locationStub = { href: 'http://localhost/', pathname: '/' };
    vi.stubGlobal('location', locationStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds Authorization header when access token is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('accessToken', 'access-token');

    const { fetchWithAuth } = await import('@/lib/utils/api');
    await fetchWithAuth('/api/test');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      })
    );
  });

  it('refreshes the access token and retries after a 401 response', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/auth/refresh') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ accessToken: 'new-token' }),
        });
      }

      return Promise.resolve({
        ok: url !== '/api/test' || fetchMock.mock.calls.length > 1,
        status: url === '/api/test' && fetchMock.mock.calls.length === 1 ? 401 : 200,
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    localStorage.setItem('accessToken', 'old-token');
    localStorage.setItem('refreshToken', 'refresh-token');

    const { fetchWithAuth } = await import('@/lib/utils/api');
    await fetchWithAuth('/api/test');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer new-token',
        }),
      })
    );
    expect(localStorage.getItem('accessToken')).toBe('new-token');
  });

  it('logs out when refresh fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 401, ok: false });
    vi.stubGlobal('fetch', fetchMock);

    localStorage.setItem('accessToken', 'old-token');
    localStorage.setItem('refreshToken', 'expired-refresh');
    localStorage.setItem('user', JSON.stringify({ id: 'user-1' }));

    isTokenExpiredMock.mockImplementation((token: string) => token.startsWith('expired'));

    locationStub.pathname = '/requests';
    locationStub.href = 'http://localhost/requests';

    const { fetchWithAuth } = await import('@/lib/utils/api');
    await fetchWithAuth('/api/test');

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(window.location.href).toContain('/login?redirect=%2Frequests');
  });
});
