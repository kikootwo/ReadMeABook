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

const lockedNote = () => screen.queryByText(/could not be loaded from Prowlarr, so they cannot be edited yet/);

describe('Indexers tab while the saved list is not loaded', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchWithAuthMock.mockReset();
    configStore.clear();
    configStore.set('prowlarr_indexers', JSON.stringify(savedIndexers));
    configStore.set('indexer_flag_config', '[]');
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

    expect(await screen.findByText(/remove your saved indexer configuration \(it could not be loaded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(lockedNote()).not.toBeInTheDocument(), { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => expect(configStore.get('prowlarr_indexers')).toBe('[]'), { timeout: 5000 });
  });
});
