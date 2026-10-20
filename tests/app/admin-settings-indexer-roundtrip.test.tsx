/**
 * Component: Admin Settings Indexer Round-Trip Tests
 * Documentation: documentation/settings-pages.md
 *
 * Drives the real settings page, real save helpers and real indexer API route
 * against an in-memory config store, so a field dropped at any hop fails here.
 */

// @vitest-environment jsdom

import React from 'react';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());
const configStore = vi.hoisted(() => new Map<string, string>());
const prowlarrMock = vi.hoisted(() => ({ getIndexers: vi.fn() }));

vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchWithAuthMock }));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: any, handler: any) => handler(req),
  requireAdmin: (_req: any, handler: any) => handler(),
}));

vi.mock('@/lib/integrations/prowlarr.service', () => ({
  getProwlarrService: async () => prowlarrMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    get: async (key: string) => configStore.get(key) ?? null,
    setMany: async (updates: Array<{ key: string; value: string }>) => {
      for (const update of updates) configStore.set(update.key, update.value);
    },
  }),
}));

const savedIndexers = [
  {
    id: 1, name: 'Torrent A', protocol: 'torrent', priority: 10, rssEnabled: true,
    audiobookCategories: [3030], ebookCategories: [7020], seedingTimeMinutes: 60, ratioLimit: 1.5,
  },
  {
    id: 2, name: 'Torrent B', protocol: 'torrent', priority: 5, rssEnabled: false,
    audiobookCategories: [3030, 3040], ebookCategories: [7020], seedingTimeMinutes: 0, ratioLimit: 2,
  },
  {
    id: 3, name: 'Usenet C', protocol: 'usenet', priority: 7, rssEnabled: false,
    audiobookCategories: [3030], ebookCategories: [7020], removeAfterProcessing: false,
  },
];

const settingsFixture = {
  backendMode: 'plex',
  hasLocalUsers: true,
  audibleRegion: 'us',
  prowlarr: { url: 'http://prowlarr:9696', apiKey: '••••••••' },
  indexerOptions: { skipUnreleased: true },
};

const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body });

/** Routes page fetches to the real indexer route handlers. */
const installFetchBridge = () => {
  fetchWithAuthMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/settings/prowlarr/indexers') {
      const route = await import('@/app/api/admin/settings/prowlarr/indexers/route');
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        return route.PUT({ json: async () => body } as any);
      }
      return route.GET({} as any);
    }
    if (url === '/api/admin/settings') return jsonResponse(settingsFixture);
    return jsonResponse({ success: true });
  });
};

const mockTabs = () => {
  vi.doMock(path.resolve('src/app/admin/settings/tabs/LibraryTab/LibraryTab.tsx'), () => ({
    LibraryTab: () => <div>Library Tab</div>,
  }));

  // Stands in for IndexerManagement: loads indexers on mount, shows each
  // indexer's ratio limit, and edits one setting on one indexer.
  vi.doMock(path.resolve('src/app/admin/settings/tabs/IndexersTab/IndexersTab.tsx'), () => ({
    IndexersTab: ({ indexers, onIndexersChange, onRefreshIndexers }: any) => {
      React.useEffect(() => {
        onRefreshIndexers?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return (
        <div>
          {indexers.map((idx: any) => (
            <div key={idx.id} data-testid={`ratio-${idx.id}`}>{String(idx.ratioLimit)}</div>
          ))}
          <button
            type="button"
            onClick={() =>
              onIndexersChange(indexers.map((idx: any) => (idx.id === 1 ? { ...idx, priority: 20 } : idx)))
            }
          >
            Edit Torrent A
          </button>
        </div>
      );
    },
  }));
};

const openIndexersTab = async () => {
  const { default: AdminSettings } = await import('@/app/admin/settings/page');
  render(<AdminSettings />);
  fireEvent.click(await screen.findByRole('button', { name: /Indexers/ }, { timeout: 5000 }));
};

describe('Admin settings indexer round trip', () => {
  beforeEach(async () => {
    vi.resetModules();
    fetchWithAuthMock.mockReset();
    configStore.clear();
    configStore.set('prowlarr_indexers', JSON.stringify(savedIndexers));
    configStore.set('indexer_flag_config', '[]');
    prowlarrMock.getIndexers.mockResolvedValue(
      savedIndexers.map(({ id, name, protocol }) => ({ id, name, protocol, privacy: 'private' }))
    );
    installFetchBridge();
    mockTabs();
    // Load the route into this module registry up front so the first fetch is not slow
    await import('@/app/api/admin/settings/prowlarr/indexers/route');
  });

  it('shows the saved ratio limit of each torrent indexer after loading', async () => {
    await openIndexersTab();

    expect(await screen.findByTestId('ratio-1', {}, { timeout: 5000 })).toHaveTextContent('1.5');
    expect(screen.getByTestId('ratio-2')).toHaveTextContent('2');
  });

  it('saving one indexer setting leaves every other per-indexer field unchanged', async () => {
    await openIndexersTab();
    await screen.findByTestId('ratio-1', {}, { timeout: 5000 });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Torrent A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith(
        '/api/admin/settings/prowlarr/indexers',
        expect.objectContaining({ method: 'PUT' })
      );
    });
    await waitFor(() => expect(screen.getByText('Settings saved successfully!')).toBeInTheDocument());

    const persisted = JSON.parse(configStore.get('prowlarr_indexers')!);
    expect(persisted).toEqual([
      { ...savedIndexers[0], priority: 20 },
      savedIndexers[1],
      savedIndexers[2],
    ]);
  });
});
