/**
 * Component: Login Page Error Message Tests
 * Documentation: documentation/frontend/pages/login.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { resetMockRouter, setMockSearchParams } from '../helpers/mock-next-navigation';
import { resetMockAuthState, setMockAuthState } from '../helpers/mock-auth';

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const plexProviders = {
  backendMode: 'plex',
  providers: ['plex'],
  registrationEnabled: false,
  hasLocalUsers: false,
  oidcProviderName: null,
  localLoginDisabled: false,
  automationEnabled: false,
};

const localProviders = { ...plexProviders, backendMode: 'audiobookshelf', providers: ['local'], registrationEnabled: true };

function stubFetch(providers: typeof plexProviders, path: string, body: unknown, status: number) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === '/api/auth/providers') return jsonResponse(providers);
    if (url === '/api/audiobooks/covers') return jsonResponse({ success: true, covers: [] });
    if (url === path) return jsonResponse(body, status);
    throw new Error(`Unexpected fetch: ${url}`);
  }));
}

async function submitAdminLogin() {
  const { default: LoginPage } = await import('@/app/login/page');
  render(<LoginPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Admin Login' }));
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: 'Login as Admin' }));
}

async function submitLocalLogin() {
  const { default: LoginPage } = await import('@/app/login/page');
  render(<LoginPage />);
  fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'reader' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
}

async function submitRegistration() {
  const { default: LoginPage } = await import('@/app/login/page');
  render(<LoginPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Don't have an account\? Register/i }));
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'new-reader' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } });
  fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Register' }));
}

describe('LoginPage error messages', () => {
  beforeEach(() => {
    resetMockRouter();
    resetMockAuthState();
    setMockAuthState({ setAuthData: vi.fn(), isLoading: false });
    localStorage.clear();
    setMockSearchParams('');
    window.innerWidth = 1024;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the readable message on a wrong admin password, not the code name', async () => {
    stubFetch(plexProviders, '/api/auth/admin/login', {
      error: 'AuthenticationError',
      message: 'Invalid username or password',
    }, 401);
    await submitAdminLogin();

    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();
    expect(screen.queryByText('AuthenticationError')).not.toBeInTheDocument();
  });

  it('still shows the sign-in limit text from error exactly', async () => {
    stubFetch(plexProviders, '/api/auth/admin/login', {
      error: 'Too many sign-in attempts for this account. Try again in 15 minutes.',
    }, 429);
    await submitAdminLogin();

    expect(await screen.findByText('Too many sign-in attempts for this account. Try again in 15 minutes.')).toBeInTheDocument();
  });

  it('still shows a rejected-account error that has no message', async () => {
    stubFetch(plexProviders, '/api/auth/admin/login', { error: 'Account has been rejected' }, 401);
    await submitAdminLogin();

    expect(await screen.findByText('Account has been rejected')).toBeInTheDocument();
  });

  it('still shows the local sign-in error text', async () => {
    stubFetch(localProviders, '/api/auth/local/login', { error: 'Invalid username or password' }, 401);
    await submitLocalLogin();

    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();
  });

  it('shows the readable message when sign-up answers with a code name', async () => {
    stubFetch(localProviders, '/api/auth/register', {
      error: 'PayloadTooLarge',
      message: 'Request body is larger than 64 KB',
    }, 413);
    await submitRegistration();

    expect(await screen.findByText('Request body is larger than 64 KB')).toBeInTheDocument();
    expect(screen.queryByText('PayloadTooLarge')).not.toBeInTheDocument();
  });

  it('still shows a sign-up error that has no message', async () => {
    stubFetch(localProviders, '/api/auth/register', { error: 'That username is already taken' }, 400);
    await submitRegistration();

    expect(await screen.findByText('That username is already taken')).toBeInTheDocument();
  });
});
