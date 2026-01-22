/**
 * Component: Header Component Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../helpers/render';

describe('Header', () => {
  let Header: typeof import('@/components/layout/Header').Header;

  beforeAll(async () => {
    ({ Header } = await import('@/components/layout/Header'));
  });

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders login button and opens Plex auth window', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      if (input === '/api/version') {
        return Promise.resolve({
          json: vi.fn().mockResolvedValue({ version: 'v.test' }),
        });
      }

      return Promise.resolve({
        json: vi.fn().mockResolvedValue({ success: true, authUrl: 'https://plex.example/login' }),
      });
    });
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Header />, { auth: { user: null, isLoading: false } });

    const loginButton = screen.getByRole('button', { name: /login with plex/i });
    await userEvent.click(loginButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/plex/login', { method: 'POST' });
    });
    expect(openMock).toHaveBeenCalledWith(
      'https://plex.example/login',
      'plex-auth',
      'width=600,height=700'
    );
  });

  it('renders admin navigation and user menu actions for local users', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ version: 'v.test' }),
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Header />, {
      auth: {
        user: {
          id: 'admin-1',
          plexId: 'plex-1',
          username: 'admin',
          role: 'admin',
          authProvider: 'local',
        },
        isLoading: false,
      },
    });

    expect(screen.getByRole('link', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Requests' })).toBeInTheDocument();

    const userButton = screen.getByText('admin').closest('button');
    expect(userButton).not.toBeNull();
    await userEvent.click(userButton as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByText('Change Password')).toBeInTheDocument();
    });
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('shows BookDate link and avatar when BookDate is enabled', async () => {
    localStorage.setItem('accessToken', 'token');
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      if (input === '/api/version') {
        return Promise.resolve({
          json: vi.fn().mockResolvedValue({ version: 'v.test' }),
        });
      }
      if (input === '/api/bookdate/config') {
        return Promise.resolve({
          json: vi.fn().mockResolvedValue({
            config: { isVerified: true, isEnabled: true },
          }),
        });
      }
      return Promise.resolve({
        json: vi.fn().mockResolvedValue({}),
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Header />, {
      auth: {
        user: {
          id: 'user-1',
          plexId: 'plex-1',
          username: 'reader',
          role: 'user',
          avatarUrl: '/avatar.png',
        },
        isLoading: false,
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'BookDate' })).toBeInTheDocument();
    });
    expect(screen.getByAltText('reader')).toBeInTheDocument();
  });

  it('logs out from the user menu and shows initials fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ version: 'v.test' }),
    });
    const logoutMock = vi.fn();

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Header />, {
      auth: {
        user: {
          id: 'user-2',
          plexId: 'plex-2',
          username: 'alice',
          role: 'user',
          authProvider: 'plex',
        },
        logout: logoutMock,
        isLoading: false,
      },
    });

    expect(screen.getByText(/^A$/)).toBeInTheDocument();

    const userButton = screen.getByText('alice').closest('button');
    expect(userButton).not.toBeNull();
    await userEvent.click(userButton as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByText('Logout')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Logout'));

    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('toggles the mobile menu and closes after navigation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ version: 'v.test' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Header />, { auth: { user: null, isLoading: false } });

    const initialHomeLinks = screen.getAllByRole('link', { name: 'Home' }).length;

    await userEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));

    const openHomeLinks = screen.getAllByRole('link', { name: 'Home' });
    expect(openHomeLinks).toHaveLength(initialHomeLinks + 1);

    await userEvent.click(openHomeLinks[openHomeLinks.length - 1]);
    expect(screen.getAllByRole('link', { name: 'Home' })).toHaveLength(initialHomeLinks);
  });

  it('hides BookDate when config check fails', async () => {
    localStorage.setItem('accessToken', 'token');
    const errorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      if (input === '/api/version') {
        return Promise.resolve({
          json: vi.fn().mockResolvedValue({ version: 'v.test' }),
        });
      }
      if (input === '/api/bookdate/config') {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve({
        json: vi.fn().mockResolvedValue({}),
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Header />, {
      auth: {
        user: {
          id: 'user-3',
          plexId: 'plex-3',
          username: 'reader',
          role: 'user',
        },
        isLoading: false,
      },
    });

    await waitFor(() => {
      expect(errorMock).toHaveBeenCalledWith('Failed to check BookDate config:', expect.any(Error));
    });

    expect(screen.queryByRole('link', { name: 'BookDate' })).not.toBeInTheDocument();
  });
});
