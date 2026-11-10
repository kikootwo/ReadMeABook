/**
 * Component: Header tests (the Library link, the nav breakpoint, the version badge's update dot)
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../helpers/render';

/** /api/version says 1.0.0; GitHub's package.json says `latest`. */
function versions(latest: string) {
  return vi.fn().mockImplementation((input: RequestInfo) => {
    const url = String(input);
    if (url === '/api/version') return Promise.resolve({ json: async () => ({ version: 'v1.0.0', fullVersion: '1.0.0' }) });
    if (url.startsWith('https://raw.githubusercontent.com/')) return Promise.resolve({ json: async () => ({ version: latest }) });
    return Promise.resolve({ json: async () => ({}) });
  });
}

const ADMIN = { id: 'admin-9', plexId: 'plex-9', username: 'a-sixteen-chars!', role: 'admin' };

describe('Header: Library link, nav breakpoint, update dot', () => {
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
    // The version badge is in the header from 640 px; from 1024 to 1279 only its update dot (below)
    const badge = (await screen.findByText(/v\.test/)).closest('div.flex-shrink-0')!;
    expect(badge.className).toContain('hidden sm:block');
    expect(badge.className).not.toContain('lg:hidden');
  });

  it('from 1024 to 1279 px an available update still shows, as a dot, for every user', async () => {
    vi.stubGlobal('fetch', versions('1.1.0'));
    renderWithProviders(<Header />, {
      auth: { user: { id: 'user-1', plexId: 'plex-1', username: 'reader', role: 'user' }, isLoading: false },
    });
    const link = await waitFor(() => {
      const el = document.querySelector('header a[data-update-available="true"]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    // Nothing on the way to the dot hides at lg: the wrapper, the link, the dot
    expect(link.closest('div.flex-shrink-0')!.className).not.toMatch(/(^|\s)lg:hidden/);
    expect(link.className).not.toMatch(/(^|\s)lg:hidden/);
    expect(link.querySelector('.bg-amber-500')!.closest('[class*="lg:hidden"]')).toBeNull();
    // The version numbers step aside at lg; the link keeps its name
    expect(screen.getByText('v1.0.0').className).toContain('lg:hidden xl:inline');
    expect(screen.getByText('v1.1.0').className).toContain('lg:hidden xl:inline');
    expect(link).toHaveAttribute('aria-label', expect.stringContaining('Update available: v1.1.0'));
  });

  it('with no update, the badge steps aside from 1024 to 1279 px', async () => {
    vi.stubGlobal('fetch', versions('1.0.0'));
    renderWithProviders(<Header />, { auth: { user: ADMIN, isLoading: false } });
    const version = await screen.findByText('v1.0.0');
    const link = version.closest('a')!;
    expect(link.className).toContain('lg:hidden xl:inline-flex');
    expect(link).not.toHaveAttribute('data-update-available');
  });
});
