/**
 * Component: Authentication Context Tests
 * Documentation: documentation/backend/services/auth.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

const isTokenExpiredMock = vi.hoisted(() => vi.fn());
const getRefreshTimeMsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/jwt-client', () => ({
  isTokenExpired: isTokenExpiredMock,
  getRefreshTimeMs: getRefreshTimeMsMock,
}));

function TestConsumer() {
  const { user, accessToken, isLoading, login, logout, refreshToken, setAuthData } = useAuth();

  return (
    <div>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="user">{user?.username ?? 'none'}</div>
      <div data-testid="token">{accessToken ?? 'none'}</div>
      <button type="button" onClick={() => void login(123)}>
        login
      </button>
      <button type="button" onClick={logout}>
        logout
      </button>
      <button type="button" onClick={() => void refreshToken()}>
        refresh
      </button>
      <button
        type="button"
        onClick={() => setAuthData({ id: 'user-99', plexId: 'plex-99', username: 'set-user', role: 'user' }, 'set-token')}
      >
        setAuth
      </button>
    </div>
  );
}

function renderAuthProvider() {
  return render(
    <AuthProvider>
      <TestConsumer />
    </AuthProvider>
  );
}

describe('AuthProvider', () => {
  let locationStub: { href: string; pathname: string };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    isTokenExpiredMock.mockReturnValue(false);
    getRefreshTimeMsMock.mockReturnValue(300_000);

    locationStub = { href: 'http://localhost/', pathname: '/' };
    vi.stubGlobal('location', locationStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores session and refreshes user details with a valid token', async () => {
    const storedUser = {
      id: 'user-1',
      plexId: 'plex-1',
      username: 'old-user',
      role: 'user',
    };

    localStorage.setItem('accessToken', 'access-token');
    localStorage.setItem('user', JSON.stringify(storedUser));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { ...storedUser, username: 'fresh-user' } }),
    });

    vi.stubGlobal('fetch', fetchMock);

    renderAuthProvider();

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('fresh-user'));

    expect(screen.getByTestId('token')).toHaveTextContent('access-token');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      })
    );

    const storedUserJson = JSON.parse(localStorage.getItem('user') ?? '{}') as { username?: string };
    expect(storedUserJson.username).toBe('fresh-user');
  });

  it('refreshes the access token on mount when the access token is expired', async () => {
    isTokenExpiredMock.mockImplementation((token: string) => token.startsWith('expired'));

    localStorage.setItem('accessToken', 'expired-access');
    localStorage.setItem('refreshToken', 'refresh-token');
    localStorage.setItem('user', JSON.stringify({ id: 'user-2' }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'new-access' }),
    });

    vi.stubGlobal('fetch', fetchMock);

    renderAuthProvider();

    await waitFor(() => expect(screen.getByTestId('token')).toHaveTextContent('new-access'));

    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(localStorage.getItem('accessToken')).toBe('new-access');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/refresh',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('clears stored auth data when both tokens are expired', async () => {
    isTokenExpiredMock.mockImplementation((token: string) => token.startsWith('expired'));

    localStorage.setItem('accessToken', 'expired-access');
    localStorage.setItem('refreshToken', 'expired-refresh');
    localStorage.setItem('user', JSON.stringify({ id: 'user-3' }));

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderAuthProvider();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stores tokens and user data after a successful login', async () => {
    const loginUser = {
      id: 'user-4',
      plexId: 'plex-4',
      username: 'plex-user',
      role: 'user',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        authorized: true,
        accessToken: 'login-access',
        refreshToken: 'login-refresh',
        user: loginUser,
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    renderAuthProvider();

    fireEvent.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('plex-user'));

    expect(screen.getByTestId('token')).toHaveTextContent('login-access');
    expect(localStorage.getItem('accessToken')).toBe('login-access');
    expect(localStorage.getItem('refreshToken')).toBe('login-refresh');
  });

  it('logs out by clearing storage and redirecting to the login page', () => {
    localStorage.setItem('accessToken', 'access-token');
    localStorage.setItem('refreshToken', 'refresh-token');
    localStorage.setItem('user', JSON.stringify({ id: 'user-5' }));

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    renderAuthProvider();

    fireEvent.click(screen.getByRole('button', { name: 'logout' }));

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(locationStub.href).toContain('/login');
  });

  it('throws when useAuth is used outside the provider', () => {
    function BrokenConsumer() {
      useAuth();
      return null;
    }

    expect(() => render(<BrokenConsumer />)).toThrow('useAuth must be used within an AuthProvider');
  });

  it('sets auth data directly and updates state', async () => {
    renderAuthProvider();

    fireEvent.click(screen.getByRole('button', { name: 'setAuth' }));

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('set-user');
    });

    expect(screen.getByTestId('token')).toHaveTextContent('set-token');
  });

  it('refreshes token when refreshToken is called', async () => {
    localStorage.setItem('refreshToken', 'refresh-token');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'refreshed-token' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderAuthProvider();

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));

    await waitFor(() => {
      expect(screen.getByTestId('token')).toHaveTextContent('refreshed-token');
    });

    expect(localStorage.getItem('accessToken')).toBe('refreshed-token');
  });

  it('logs out when access token is removed in another tab', async () => {
    renderAuthProvider();

    fireEvent.click(screen.getByRole('button', { name: 'setAuth' }));
    await waitFor(() => {
      expect(screen.getByTestId('token')).toHaveTextContent('set-token');
    });

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'accessToken', newValue: null }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('token')).toHaveTextContent('none');
    });

    expect(locationStub.href).toContain('/login');
  });

  it('syncs auth data when access token is added in another tab', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 'user-sync', plexId: 'plex-sync', username: 'synced', role: 'user' }));

    renderAuthProvider();

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'accessToken', newValue: 'synced-token' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('synced');
    });

    expect(screen.getByTestId('token')).toHaveTextContent('synced-token');
  });
});
