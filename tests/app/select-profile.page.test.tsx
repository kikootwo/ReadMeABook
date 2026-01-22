/**
 * Component: Select Profile Page Tests
 * Documentation: documentation/backend/services/auth.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockAuthState, setMockAuthState } from '../helpers/mock-auth';
import { resetMockRouter, routerMock, setMockSearchParams } from '../helpers/mock-next-navigation';

const makeJsonResponse = (body: any, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
});

describe('SelectProfilePage', () => {
  beforeEach(() => {
    resetMockAuthState();
    resetMockRouter();
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows an error when session info is missing', async () => {
    setMockSearchParams('');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { default: SelectProfilePage } = await import('@/app/auth/select-profile/page');
    render(<SelectProfilePage />);

    expect(await screen.findByText('Invalid session. Please try logging in again.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to Login' }));
    expect(routerMock.push).toHaveBeenCalledWith('/login');
  });

  it('selects an unprotected profile and stores auth data', async () => {
    sessionStorage.setItem('plex_main_token', 'main-token');
    setMockSearchParams('pinId=123');

    const setAuthDataMock = vi.fn();
    setMockAuthState({ setAuthData: setAuthDataMock, isLoading: false });

    const profiles = [
      {
        id: 'profile-1',
        uuid: 'uuid-1',
        title: 'User',
        friendlyName: 'Primary',
        username: 'primary',
        email: 'primary@example.com',
        thumb: 'http://thumb',
        hasPassword: false,
        restricted: false,
        admin: true,
        guest: false,
        protected: false,
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/plex/home-users') {
        return makeJsonResponse({ users: profiles });
      }
      if (url === '/api/auth/plex/switch-profile') {
        return makeJsonResponse({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          user: { id: 'user-1', plexId: 'plex-1', username: 'primary', role: 'user' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: SelectProfilePage } = await import('@/app/auth/select-profile/page');
    render(<SelectProfilePage />);

    const profileButton = await screen.findByRole('button', { name: /Primary/ });
    fireEvent.click(profileButton);

    await waitFor(() => {
      expect(setAuthDataMock).toHaveBeenCalledWith(
        { id: 'user-1', plexId: 'plex-1', username: 'primary', role: 'user' },
        'access-token'
      );
      expect(routerMock.push).toHaveBeenCalledWith('/');
    });

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body.userId).toBe('profile-1');
    expect(body.pinId).toBe('123');
    expect(localStorage.getItem('accessToken')).toBe('access-token');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-token');
  });

  it('prompts for a PIN and handles invalid submissions', async () => {
    sessionStorage.setItem('plex_main_token', 'main-token');
    setMockSearchParams('pinId=555');

    const setAuthDataMock = vi.fn();
    setMockAuthState({ setAuthData: setAuthDataMock, isLoading: false });

    const profiles = [
      {
        id: 'profile-2',
        uuid: 'uuid-2',
        title: 'Protected',
        friendlyName: 'Protected',
        username: 'protected',
        email: 'protected@example.com',
        thumb: '',
        hasPassword: true,
        restricted: false,
        admin: false,
        guest: false,
        protected: true,
      },
    ];

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === '/api/auth/plex/home-users') {
        return makeJsonResponse({ users: profiles });
      }
      if (url === '/api/auth/plex/switch-profile') {
        return makeJsonResponse({ message: 'Invalid PIN' }, false, 401);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { default: SelectProfilePage } = await import('@/app/auth/select-profile/page');
    render(<SelectProfilePage />);

    const profileButton = await screen.findByRole('button', { name: /Protected/ });
    fireEvent.click(profileButton);

    const pinInput = await screen.findByPlaceholderText('Enter PIN');
    fireEvent.change(pinInput, { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Invalid PIN. Please try again.')).toBeInTheDocument();
    expect((pinInput as HTMLInputElement).value).toBe('');
    expect(setAuthDataMock).not.toHaveBeenCalled();
  });
});
