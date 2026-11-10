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

  it('opens change password modal and closes it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ version: 'v.test' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Header />, {
      auth: {
        user: {
          id: 'user-4',
          plexId: 'plex-4',
          username: 'local-admin',
          role: 'admin',
          authProvider: 'local',
        },
        isLoading: false,
      },
    });

    const userButton = screen.getByText('local-admin').closest('button');
    expect(userButton).not.toBeNull();
    await userEvent.click(userButton as HTMLButtonElement);

    const changePasswordButton = await screen.findByText('Change Password');
    await userEvent.click(changePasswordButton);

    expect(await screen.findByRole('heading', { name: 'Change Password' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Change Password' })).not.toBeInTheDocument();
    });
  });

  it('offers the theme choice in the user menu and keeps the menu open after a pick', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ version: 'v.test' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Header />, {
      auth: {
        user: { id: 'user-7', plexId: 'plex-7', username: 'reader', role: 'user', authProvider: 'plex' },
        isLoading: false,
      },
    });

    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('reader').closest('button') as HTMLButtonElement);

    const group = await screen.findByRole('radiogroup', { name: 'Theme' });
    expect(group).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    });
    expect(screen.getByText('Logout')).toBeInTheDocument();
    document.documentElement.removeAttribute('data-theme');
  });

  it('closes the user menu when profile is clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ version: 'v.test' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Header />, {
      auth: {
        user: {
          id: 'user-5',
          plexId: 'plex-5',
          username: 'reader',
          role: 'user',
          authProvider: 'local',
        },
        isLoading: false,
      },
    });

    const userButton = screen.getByText('reader').closest('button');
    expect(userButton).not.toBeNull();
    await userEvent.click(userButton as HTMLButtonElement);

    const profileLink = await screen.findByRole('link', { name: 'Profile' });
    await userEvent.click(profileLink);

    await waitFor(() => {
      expect(screen.queryByText('Logout')).not.toBeInTheDocument();
    });
  });

  it('logs errors when Plex login fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('login failed'));
    const errorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null);

    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<Header />, { auth: { user: null, isLoading: false } });

    await userEvent.click(screen.getByRole('button', { name: /login with plex/i }));

    await waitFor(() => {
      expect(errorMock).toHaveBeenCalledWith('Login failed:', expect.any(Error));
    });
    expect(openMock).not.toHaveBeenCalled();
  });

  it('closes the mobile menu when BookDate is selected', async () => {
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
          id: 'user-6',
          plexId: 'plex-6',
          username: 'reader',
          role: 'user',
        },
        isLoading: false,
      },
    });

    const initialBookDateCount = (await screen.findAllByRole('link', { name: 'BookDate' })).length;

    await userEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));

    const bookDateLinks = await screen.findAllByRole('link', { name: 'BookDate' });
    expect(bookDateLinks).toHaveLength(initialBookDateCount + 1);

    await userEvent.click(bookDateLinks[bookDateLinks.length - 1]);

    await waitFor(async () => {
      const remainingLinks = await screen.findAllByRole('link', { name: 'BookDate' });
      expect(remainingLinks).toHaveLength(initialBookDateCount);
    });
  });
  it('shows Library right before My Requests, desktop and mobile, for any signed-in user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: vi.fn().mockResolvedValue({ version: 'v.test' }) }));
    renderWithProviders(<Header />, {
      auth: { user: { id: 'user-9', plexId: 'plex-9', username: 'reader', role: 'user' }, isLoading: false },
    });

    const desktop = screen.getByRole('link', { name: 'Library' });
    expect(desktop).toHaveAttribute('href', '/library');
    const desktopNames = Array.from(desktop.closest('nav')!.querySelectorAll('a')).map((a) => a.textContent?.trim());
    expect(desktopNames.indexOf('Library')).toBe(desktopNames.indexOf('My Requests') - 1);

    await userEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
    const links = screen.getAllByRole('link', { name: 'Library' });
    expect(links).toHaveLength(2);
    const mobileNames = Array.from(links[1].closest('nav')!.querySelectorAll('a')).map((a) => a.textContent?.trim());
    expect(mobileNames.indexOf('Library')).toBe(mobileNames.indexOf('My Requests') - 1);
    await userEvent.click(links[1]);
    expect(screen.getAllByRole('link', { name: 'Library' })).toHaveLength(1);
  });

  it('hides Library when signed out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: vi.fn().mockResolvedValue({ version: 'v.test' }) }));
    renderWithProviders(<Header />, { auth: { user: null, isLoading: false } });
    expect(screen.queryByRole('link', { name: 'Library' })).toBeNull();
  });

  it('keeps the full nav for 1024 px and up; below that the menu button carries it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: vi.fn().mockResolvedValue({ version: 'v.test' }) }));
    renderWithProviders(<Header />, {
      auth: { user: { id: 'admin-9', plexId: 'plex-9', username: 'a-sixteen-chars!', role: 'admin' }, isLoading: false },
    });
    // jsdom has no layout: the e2e header check measures overflow at 768 and 1024
    const nav = screen.getByRole('link', { name: 'Library' }).closest('nav')!;
    expect(nav.className).toContain('hidden lg:flex');
    expect(nav.className).toContain('whitespace-nowrap'); // "My Requests" never wraps
    expect(screen.getByRole('button', { name: 'Toggle menu' }).className).toContain('lg:hidden');
    expect(screen.getByText('a-sixteen-chars!').className).toContain('hidden xl:inline');
    // The version badge steps aside while the inline nav is on a narrow desktop (1024-1279)
    const badge = (await screen.findByText(/v\.test/)).closest('div.flex-shrink-0')!;
    expect(badge.className).toContain('hidden sm:block lg:hidden xl:block');
  });
});
