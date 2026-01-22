/**
 * Component: Login Page Tests
 * Documentation: documentation/frontend/pages/login.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { resetMockRouter, routerMock, setMockSearchParams } from '../helpers/mock-next-navigation';
import { resetMockAuthState, setMockAuthState } from '../helpers/mock-auth';

const makeJsonResponse = (body: any, ok: boolean = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
});

const baseProviders = {
  backendMode: 'plex',
  providers: ['plex'],
  registrationEnabled: false,
  hasLocalUsers: false,
  oidcProviderName: null,
  localLoginDisabled: false,
  automationEnabled: false,
};

describe('LoginPage', () => {
  beforeEach(() => {
    resetMockRouter();
    resetMockAuthState();
    localStorage.clear();
    setMockSearchParams('');
    window.innerWidth = 1024;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders description based on backend mode and automation flag', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') {
        return makeJsonResponse({
          ...baseProviders,
          backendMode: 'audiobookshelf',
          automationEnabled: true,
        });
      }
      if (url === '/api/audiobooks/covers') {
        return makeJsonResponse({ success: true, covers: [] });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    expect(
      await screen.findByText(
        "Request audiobooks and they'll automatically download and appear in your Audiobookshelf library"
      )
    ).toBeInTheDocument();
  });

  it('redirects to intended page when user is already logged in', async () => {
    setMockAuthState({
      user: { id: 'user-1', plexId: 'plex-1', username: 'user', role: 'user' },
      isLoading: false,
    });
    setMockSearchParams('redirect=/requests');

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(baseProviders);
      if (url === '/api/audiobooks/covers') return makeJsonResponse({ success: true, covers: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    await waitFor(() => {
      expect(routerMock.push).toHaveBeenCalledWith('/requests');
    });
  });

  it('handles Plex login with popup flow', async () => {
    const loginMock = vi.fn().mockResolvedValue(undefined);
    setMockAuthState({ login: loginMock, isLoading: false });

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(baseProviders);
      if (url === '/api/audiobooks/covers') return makeJsonResponse({ success: true, covers: [] });
      if (url === '/api/auth/plex/login') {
        return makeJsonResponse({ pinId: 123, authUrl: 'http://plex/auth' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    const closeMock = vi.fn();
    const openMock = vi.fn().mockReturnValue({ close: closeMock });
    vi.stubGlobal('open', openMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    const loginButton = await screen.findByRole('button', { name: 'Login with Plex' });
    fireEvent.click(loginButton);

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith(123);
      expect(routerMock.push).toHaveBeenCalledWith('/');
    });
    expect(openMock).toHaveBeenCalledWith(
      'http://plex/auth',
      'plex-auth',
      'width=600,height=700,scrollbars=yes,resizable=yes'
    );
    expect(closeMock).toHaveBeenCalled();
  });

  it('shows an error when Plex login popup is blocked', async () => {
    const loginMock = vi.fn().mockResolvedValue(undefined);
    setMockAuthState({ login: loginMock, isLoading: false });

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(baseProviders);
      if (url === '/api/audiobooks/covers') return makeJsonResponse({ success: true, covers: [] });
      if (url === '/api/auth/plex/login') {
        return makeJsonResponse({ pinId: 456, authUrl: 'http://plex/auth' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn().mockReturnValue(null));

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    const loginButton = await screen.findByRole('button', { name: 'Login with Plex' });
    fireEvent.click(loginButton);

    expect(await screen.findByText(/Popup was blocked/i)).toBeInTheDocument();
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('logs in with local credentials and stores tokens', async () => {
    const setAuthDataMock = vi.fn();
    setMockAuthState({ setAuthData: setAuthDataMock, isLoading: false });

    const providers = {
      ...baseProviders,
      providers: ['local'],
    };

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(providers);
      if (url === '/api/audiobooks/covers') return makeJsonResponse({ success: true, covers: [] });
      if (url === '/api/auth/local/login') {
        return makeJsonResponse({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          user: { id: 'user-1', username: 'local-user', role: 'admin' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    const username = await screen.findByLabelText('Username');
    const password = screen.getByLabelText('Password');

    fireEvent.change(username, { target: { value: 'admin' } });
    fireEvent.change(password, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(setAuthDataMock).toHaveBeenCalledWith(
        { id: 'user-1', username: 'local-user', role: 'admin' },
        'access-token'
      );
      expect(routerMock.push).toHaveBeenCalledWith('/');
    });

    expect(localStorage.getItem('accessToken')).toBe('access-token');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-token');
  });

  it('validates registration passwords before sending request', async () => {
    const providers = {
      ...baseProviders,
      providers: ['local'],
      registrationEnabled: true,
    };

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(providers);
      if (url === '/api/audiobooks/covers') return makeJsonResponse({ success: true, covers: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    const registerToggle = await screen.findByRole('button', { name: /Don't have an account\? Register/i });
    fireEvent.click(registerToggle);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'new-user' } });
    const passwordInputs = screen.getAllByLabelText('Password');
    fireEvent.change(passwordInputs[0], { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
  });

  it('renders an OIDC login button and redirects to the provider', async () => {
    const providers = {
      ...baseProviders,
      providers: ['oidc'],
      oidcProviderName: 'Auth0',
    };

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(providers);
      if (url === '/api/audiobooks/covers') return makeJsonResponse({ success: true, covers: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    expect(await screen.findByRole('button', { name: 'Login with Auth0' })).toBeInTheDocument();
    expect(
      screen.getByText("You'll be redirected to Auth0 to authenticate")
    ).toBeInTheDocument();
  });

  it('logs in via admin credentials when Plex mode exposes admin login', async () => {
    const setAuthDataMock = vi.fn();
    setMockAuthState({ setAuthData: setAuthDataMock, isLoading: false });

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(baseProviders);
      if (url === '/api/audiobooks/covers') return makeJsonResponse({ success: true, covers: [] });
      if (url === '/api/auth/admin/login') {
        return makeJsonResponse({
          accessToken: 'admin-access',
          refreshToken: 'admin-refresh',
          user: { id: 'admin-1', username: 'admin', role: 'admin' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    const toggleButton = await screen.findByRole('button', { name: 'Admin Login' });
    fireEvent.click(toggleButton);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login as Admin' }));

    await waitFor(() => {
      expect(setAuthDataMock).toHaveBeenCalledWith(
        { id: 'admin-1', username: 'admin', role: 'admin' },
        'admin-access'
      );
      expect(routerMock.push).toHaveBeenCalledWith('/');
    });

    expect(localStorage.getItem('accessToken')).toBe('admin-access');
    expect(localStorage.getItem('refreshToken')).toBe('admin-refresh');
  });

  it('renders book cover images when the covers API returns data', async () => {
    window.innerWidth = 500;

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(baseProviders);
      if (url === '/api/audiobooks/covers') {
        return makeJsonResponse({
          success: true,
          covers: [
            {
              asin: 'asin-1',
              title: 'Book One',
              author: 'Author',
              coverUrl: '/cover.jpg',
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    expect(await screen.findByAltText('Book One')).toBeInTheDocument();
  });

  it('shows pending approval alert when admin login returns pending status', async () => {
    const setAuthDataMock = vi.fn();
    setMockAuthState({ setAuthData: setAuthDataMock, isLoading: false });

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(baseProviders);
      if (url === '/api/audiobooks/covers') return makeJsonResponse({ success: true, covers: [] });
      if (url === '/api/auth/admin/login') {
        return makeJsonResponse({ pendingApproval: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Admin Login' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login as Admin' }));

    expect(await screen.findByText('Account Pending Approval')).toBeInTheDocument();
    expect(setAuthDataMock).not.toHaveBeenCalled();
  });

  it('shows registration pending alert when registration needs approval', async () => {
    const providers = {
      ...baseProviders,
      providers: ['local'],
      registrationEnabled: true,
    };
    const setAuthDataMock = vi.fn();
    setMockAuthState({ setAuthData: setAuthDataMock, isLoading: false });

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(providers);
      if (url === '/api/audiobooks/covers') return makeJsonResponse({ success: true, covers: [] });
      if (url === '/api/auth/register') {
        return makeJsonResponse({ pendingApproval: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: /Don't have an account\? Register/i })
    );
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'new-user' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    expect(await screen.findByText('Registration Pending')).toBeInTheDocument();
    expect(setAuthDataMock).not.toHaveBeenCalled();
  });

  it('auto-logs in after successful registration', async () => {
    const providers = {
      ...baseProviders,
      providers: ['local'],
      registrationEnabled: true,
    };
    const setAuthDataMock = vi.fn();
    setMockAuthState({ setAuthData: setAuthDataMock, isLoading: false });

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(providers);
      if (url === '/api/audiobooks/covers') return makeJsonResponse({ success: true, covers: [] });
      if (url === '/api/auth/register') {
        return makeJsonResponse({
          success: true,
          accessToken: 'reg-access',
          refreshToken: 'reg-refresh',
          user: { id: 'user-3', username: 'new-user', role: 'user' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    fireEvent.click(
      await screen.findByRole('button', { name: /Don't have an account\? Register/i })
    );
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'new-user' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => {
      expect(setAuthDataMock).toHaveBeenCalledWith(
        { id: 'user-3', username: 'new-user', role: 'user' },
        'reg-access'
      );
      expect(routerMock.push).toHaveBeenCalledWith('/');
    });

    expect(localStorage.getItem('accessToken')).toBe('reg-access');
    expect(localStorage.getItem('refreshToken')).toBe('reg-refresh');
  });

  it('falls back to Plex mode when providers fetch fails', async () => {
    const errorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') {
        throw new Error('providers down');
      }
      if (url === '/api/audiobooks/covers') {
        throw new Error('covers down');
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    expect(await screen.findByRole('button', { name: 'Login with Plex' })).toBeInTheDocument();
    expect(errorMock).toHaveBeenCalledWith('Failed to fetch auth providers:', expect.any(Error));
    expect(errorMock).toHaveBeenCalledWith('Failed to fetch book covers:', expect.any(Error));
  });

  it('processes mobile auth data from URL hash', async () => {
    const setAuthDataMock = vi.fn();
    setMockAuthState({ setAuthData: setAuthDataMock, isLoading: false });
    setMockSearchParams('auth=success&redirect=/requests');

    const authData = {
      accessToken: 'mobile-access',
      refreshToken: 'mobile-refresh',
      user: { id: 'user-9', username: 'mobile-user', role: 'user' },
    };
    window.location.hash = `#authData=${encodeURIComponent(JSON.stringify(authData))}`;

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(baseProviders);
      if (url === '/api/audiobooks/covers') return makeJsonResponse({ success: true, covers: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    await waitFor(() => {
      expect(setAuthDataMock).toHaveBeenCalledWith(authData.user, authData.accessToken);
      expect(routerMock.push).toHaveBeenCalledWith('/requests');
    });

    expect(localStorage.getItem('accessToken')).toBe('mobile-access');
    expect(localStorage.getItem('refreshToken')).toBe('mobile-refresh');
    expect(window.location.hash).toBe('');
  });

  it('shows error message from query string', async () => {
    setMockSearchParams('error=Access%20Denied');

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/providers') return makeJsonResponse(baseProviders);
      if (url === '/api/audiobooks/covers') return makeJsonResponse({ success: true, covers: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: LoginPage } = await import('@/app/login/page');
    render(<LoginPage />);

    expect(await screen.findByText('Access Denied')).toBeInTheDocument();
  });
});
