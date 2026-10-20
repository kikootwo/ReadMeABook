/**
 * Component: Admin Settings Indexers Tab - list not loaded (real tab UI)
 * Documentation: documentation/settings-pages.md
 *
 * The real Indexers tab and indexer management UI over the real indexer
 * route, with Prowlarr's saved-list endpoint failing: editing is locked, the
 * connection-change confirm still appears, and a fetch that succeeds unlocks.
 */

// @vitest-environment jsdom

import React from 'react';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());
const configStore = vi.hoisted(() => new Map<string, string>());
const prowlarrMock = vi.hoisted(() => ({ getIndexers: vi.fn() }));
const bridge = vi.hoisted(() => ({ savedListFails: true }));

vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchWithAuthMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: any, handler: any) => handler(req),
  requireAdmin: (_req: any, handler: any) => handler(),
}));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ getProwlarrService: async () => prowlarrMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    get: async (key: string) => configStore.get(key) ?? null,
    setMany: async (updates: Array<{ key: string; value: string }>) => {
      for (const update of updates) configStore.set(update.key, update.value);
    },
  }),
}));

const savedIndexers = [
  { id: 1, name: 'Tracker', protocol: 'torrent', priority: 10, rssEnabled: false, audiobookCategories: [3030], ebookCategories: [7020], seedingTimeMinutes: 60, ratioLimit: 1.5 },
];
const prowlarrIndexers = [{ id: 1, name: 'Tracker', protocol: 'torrent', privacy: 'private', supportsRss: true }];
const settingsFixture = {
  backendMode: 'plex',
  hasLocalUsers: true,
  audibleRegion: 'us',
  prowlarr: { url: 'http://old-prowlarr:9696', apiKey: '••••••••' },
  indexerOptions: { skipUnreleased: true },
};
const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

function installBridge() {
  fetchWithAuthMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/settings') return json(settingsFixture);
    if (url === '/api/admin/settings/test-prowlarr') return json({ success: true, indexers: prowlarrIndexers });
    if (url === '/api/admin/settings/prowlarr/indexers') {
      const route = await import('@/app/api/admin/settings/prowlarr/indexers/route');
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        return route.PUT({ json: async () => body } as any);
      }
      return bridge.savedListFails ? json({ success: false }, false, 500) : route.GET({} as any);
    }
    return json({ success: true });
  });
}

async function openIndexersTab() {
  vi.doMock(path.resolve('src/app/admin/settings/tabs/LibraryTab/LibraryTab.tsx'), () => ({
    LibraryTab: () => <div>Library Tab</div>,
  }));
  await import('@/app/api/admin/settings/prowlarr/indexers/route');
  const { default: AdminSettings } = await import('@/app/admin/settings/page');
  render(<AdminSettings />);
  fireEvent.click(await screen.findByRole('button', { name: /Indexers/ }, { timeout: 5000 }));
}

const FLAG_RULES = JSON.stringify([{ name: 'freeleech', modifier: 10 }]);
const lockedNote = () => screen.queryByText(/could not be loaded from Prowlarr, so they cannot be edited yet/);

describe('Indexers tab while the saved list is not loaded', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchWithAuthMock.mockReset();
    configStore.clear();
    configStore.set('prowlarr_indexers', JSON.stringify(savedIndexers));
    configStore.set('indexer_flag_config', FLAG_RULES);
    prowlarrMock.getIndexers.mockResolvedValue(prowlarrIndexers);
    bridge.savedListFails = true;
    installBridge();
  });

  it('locks editing until a fetch succeeds, then loads the saved list and unlocks', async () => {
    await openIndexersTab();

    await waitFor(() => expect(lockedNote()).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByRole('button', { name: '+ Add Flag Rule' })).toBeDisabled();

    // Prowlarr reachable again: fetching the available indexers also loads the saved list
    bridge.savedListFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Fetch Indexers' }));

    await waitFor(() => expect(lockedNote()).not.toBeInTheDocument(), { timeout: 5000 });
    expect(await screen.findByText('Configured Indexers (1)', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add Flag Rule' })).toBeEnabled();
  });

  it('asks before replacing a list it could not load when the connection changes, and saves the clear', async () => {
    await openIndexersTab();
    await waitFor(() => expect(lockedNote()).toBeInTheDocument(), { timeout: 5000 });

    fireEvent.change(screen.getByPlaceholderText('http://localhost:9696'), { target: { value: 'http://new-prowlarr:9696' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    expect(await screen.findByText(/Your saved indexers could not be loaded, so they are not shown/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(lockedNote()).not.toBeInTheDocument(), { timeout: 5000 });
    // Flag rules were never loaded: still locked (with a note), and not part of the save
    expect(screen.getByRole('button', { name: '+ Add Flag Rule' })).toBeDisabled();
    expect(screen.getByText(/Your saved flag rules are kept/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => expect(configStore.get('prowlarr_indexers')).toBe('[]'), { timeout: 5000 });
    expect(configStore.get('indexer_flag_config')).toBe(FLAG_RULES);
  });

  it('keeps the saved indexers when Prowlarr moved, and loads them from the new address after saving', async () => {
    await openIndexersTab();
    await waitFor(() => expect(lockedNote()).toBeInTheDocument(), { timeout: 5000 });
    const saved = configStore.get('prowlarr_indexers');
    expect(await screen.findByText(/Failed to load indexers/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('http://localhost:9696'), { target: { value: 'http://moved-prowlarr:9696' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep saved indexers' }));

    // Tested without clearing: still not loaded, nothing removed
    expect(await screen.findByText(/Connected to Prowlarr\. Found 1 indexers\. Save to load your saved indexers from the new address\./, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(lockedNote()).toBeInTheDocument();
    // No reload through the old address (it would only fail again and post a second load-failure banner)
    const indexerGets = () => fetchWithAuthMock.mock.calls.filter(
      ([url, init]) => url === '/api/admin/settings/prowlarr/indexers' && !(init as RequestInit | undefined)?.method
    ).length;
    expect(indexerGets()).toBe(1); // only the initial load
    // The success replaces the mount-time load-failure banner
    expect(screen.queryByText(/Failed to load indexers/)).not.toBeInTheDocument();

    // The new address answers once it is saved
    bridge.savedListFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(await screen.findByText('Settings saved. Indexers loaded from Prowlarr.', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText('Configured Indexers (1)', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(lockedNote()).not.toBeInTheDocument();
    expect(configStore.get('prowlarr_indexers')).toBe(saved);
    expect(configStore.get('indexer_flag_config')).toBe(FLAG_RULES);
  });

  it('a save while the list is unavailable reports success and changes neither indexers nor flags', async () => {
    await openIndexersTab();
    await waitFor(() => expect(lockedNote()).toBeInTheDocument(), { timeout: 5000 });

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(await screen.findByText(/Settings saved\. Your saved indexers could not be loaded/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(configStore.get('prowlarr_indexers')).toBe(JSON.stringify(savedIndexers));
    expect(configStore.get('indexer_flag_config')).toBe(FLAG_RULES);
  });
});
