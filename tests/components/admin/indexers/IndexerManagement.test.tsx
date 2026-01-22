/**
 * Component: Indexer Management Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IndexerManagement } from '@/components/admin/indexers/IndexerManagement';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

vi.mock('@/components/admin/indexers/IndexerConfigModal', () => ({
  IndexerConfigModal: ({ isOpen, mode, indexer, initialConfig, onSave, onClose }: any) => {
    if (!isOpen) return null;
    const priority = initialConfig?.priority ? initialConfig.priority + 1 : 10;
    return (
      <div data-testid="indexer-config-modal">
        <div data-testid="modal-mode">{mode}</div>
        <button
          onClick={() =>
            onSave({
              id: indexer.id,
              name: indexer.name,
              priority,
              seedingTimeMinutes: 0,
              rssEnabled: true,
              categories: [3030],
            })
          }
        >
          Save
        </button>
        <button onClick={onClose}>Close</button>
      </div>
    );
  },
}));

describe('IndexerManagement', () => {
  const emptyIndexers: any[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchWithAuthMock.mockReset();
  });

  it('fetches indexers in wizard mode and adds a configuration', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        indexers: [
          { id: 1, name: 'IndexerA', protocol: 'torrent', supportsRss: true },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const onIndexersChange = vi.fn();

    render(
      <IndexerManagement
        prowlarrUrl="http://prowlarr.local"
        prowlarrApiKey="apikey"
        mode="wizard"
        initialIndexers={emptyIndexers}
        onIndexersChange={onIndexersChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fetch Indexers' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/setup/test-prowlarr', expect.any(Object));
    });

    expect(fetchWithAuthMock).not.toHaveBeenCalled();
    expect(screen.getByText('IndexerA')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const lastCall = onIndexersChange.mock.calls.at(-1)?.[0] as any[] | undefined;
      expect(lastCall).toHaveLength(1);
      expect(lastCall?.[0]).toMatchObject({ id: 1, name: 'IndexerA' });
    });

    expect(screen.getByText('Configured Indexers (1)')).toBeInTheDocument();
  });

  it('uses authenticated fetch in settings mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        indexers: [
          { id: 2, name: 'IndexerB', protocol: 'torrent', supportsRss: false },
        ],
      }),
    });

    render(
      <IndexerManagement
        prowlarrUrl="http://prowlarr.local"
        prowlarrApiKey="apikey"
        mode="settings"
        initialIndexers={emptyIndexers}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fetch Indexers' }));

    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith(
        '/api/admin/settings/test-prowlarr',
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('IndexerB')).toBeInTheDocument();
  });

  it('removes a configured indexer after confirmation', async () => {
    const onIndexersChange = vi.fn();

    render(
      <IndexerManagement
        prowlarrUrl="http://prowlarr.local"
        prowlarrApiKey="apikey"
        mode="settings"
        initialIndexers={[
          {
            id: 5,
            name: 'ConfiguredIndexer',
            priority: 10,
            seedingTimeMinutes: 0,
            rssEnabled: true,
            categories: [3030],
          },
        ]}
        onIndexersChange={onIndexersChange}
      />
    );

    fireEvent.click(screen.getByTitle('Delete indexer'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Indexer' }));

    await waitFor(() => {
      const lastCall = onIndexersChange.mock.calls.at(-1)?.[0] as any[] | undefined;
      expect(lastCall).toHaveLength(0);
    });

    expect(screen.getByText('Configured Indexers (0)')).toBeInTheDocument();
  });
});
