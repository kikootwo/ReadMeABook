/**
 * Component: Admin Settings - Indexers Tab Auto-load Test
 * Documentation: documentation/testing.md
 *
 * This test verifies that indexers are automatically loaded when:
 * 1. The prowlarr tab becomes active
 * 2. Prowlarr URL and API key are configured
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { IndexersTab } from '@/app/admin/settings/tabs/IndexersTab';
import type { Settings, SavedIndexerConfig } from '@/app/admin/settings/lib/types';
import { IndexerFlagConfig } from '@/lib/utils/ranking-algorithm';

// Mock fetchWithAuth
const mockFetchWithAuth = vi.fn();
vi.mock('@/lib/utils/api', () => ({
  fetchWithAuth: (url: string, options?: any) => mockFetchWithAuth(url, options),
}));

// Mock child components to simplify testing
vi.mock('@/components/admin/indexers/IndexerManagement', () => ({
  IndexerManagement: ({ initialIndexers }: { initialIndexers: SavedIndexerConfig[] }) => (
    <div data-testid="indexer-management">
      {initialIndexers.length > 0 ? (
        <div data-testid="indexers-loaded">
          {initialIndexers.length} indexers loaded
        </div>
      ) : (
        <div data-testid="indexers-empty">No indexers</div>
      )}
    </div>
  ),
}));

vi.mock('@/components/admin/FlagConfigRow', () => ({
  FlagConfigRow: () => <div data-testid="flag-config-row">Flag Config</div>,
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, loading, disabled, ...props }: any) => (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      data-testid={props['data-testid'] || 'button'}
    >
      {loading ? 'Loading...' : children}
    </button>
  ),
}));

vi.mock('@/components/ui/Input', () => ({
  Input: (props: any) => <input {...props} data-testid={props['data-testid'] || 'input'} />,
}));

describe('IndexersTab - Auto-load Indexers on Tab Activation', () => {
  const mockSettings: Settings = {
    backendMode: 'plex',
    hasLocalUsers: false,
    audibleRegion: 'us',
    plex: {
      url: 'http://plex.local:32400',
      token: 'test-token',
      libraryId: '1',
      triggerScanAfterImport: false,
    },
    audiobookshelf: {
      serverUrl: '',
      apiToken: '',
      libraryId: '',
      triggerScanAfterImport: false,
    },
    oidc: {
      enabled: false,
      providerName: '',
      issuerUrl: '',
      clientId: '',
      clientSecret: '',
      accessControlMethod: 'open',
      accessGroupClaim: '',
      accessGroupValue: '',
      allowedEmails: '',
      allowedUsernames: '',
      adminClaimEnabled: false,
      adminClaimName: '',
      adminClaimValue: '',
    },
    registration: {
      enabled: false,
      requireAdminApproval: false,
    },
    prowlarr: {
      url: 'http://prowlarr.local:9696',
      apiKey: 'test-api-key',
    },
    downloadClient: {
      type: 'qbittorrent',
      url: 'http://localhost:8080',
      username: 'admin',
      password: 'password',
      disableSSLVerify: false,
      remotePathMappingEnabled: false,
      remotePath: '',
      localPath: '',
    },
    paths: {
      downloadDir: '/downloads',
      mediaDir: '/media',
      metadataTaggingEnabled: true,
      chapterMergingEnabled: true,
    },
    ebook: {
      enabled: false,
      preferredFormat: 'epub',
      baseUrl: 'https://annas-archive.gl',
      flaresolverrUrl: '',
    },
  };

  const mockIndexers: SavedIndexerConfig[] = [
    {
      id: 1,
      name: 'AudioBook Bay',
      protocol: 'torrent',
      priority: 10,
      seedingTimeMinutes: 4320,
      rssEnabled: true,
      categories: [3030],
    },
    {
      id: 2,
      name: 'MyAnonaMouse',
      protocol: 'usenet',
      priority: 15,
      removeAfterProcessing: true,
      rssEnabled: false,
      categories: [3030],
    },
  ];

  const mockFlagConfigs: IndexerFlagConfig[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display empty indexers when no indexers are loaded', () => {
    const { container } = render(
      <IndexersTab
        settings={mockSettings}
        indexers={[]}
        flagConfigs={mockFlagConfigs}
        onChange={vi.fn()}
        onIndexersChange={vi.fn()}
        onFlagConfigsChange={vi.fn()}
        onValidationChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('indexers-empty')).toBeInTheDocument();
  });

  it('should display indexers when indexers prop contains data', () => {
    render(
      <IndexersTab
        settings={mockSettings}
        indexers={mockIndexers}
        flagConfigs={mockFlagConfigs}
        onChange={vi.fn()}
        onIndexersChange={vi.fn()}
        onFlagConfigsChange={vi.fn()}
        onValidationChange={vi.fn()}
      />
    );

    expect(screen.getByTestId('indexers-loaded')).toBeInTheDocument();
    expect(screen.getByText('2 indexers loaded')).toBeInTheDocument();
  });

  it('BUG: should automatically fetch indexers when onRefreshIndexers is called on mount', async () => {
    const mockOnRefreshIndexers = vi.fn().mockResolvedValue(undefined);

    render(
      <IndexersTab
        settings={mockSettings}
        indexers={[]} // Start with empty
        flagConfigs={mockFlagConfigs}
        onChange={vi.fn()}
        onIndexersChange={vi.fn()}
        onFlagConfigsChange={vi.fn()}
        onValidationChange={vi.fn()}
        onRefreshIndexers={mockOnRefreshIndexers}
      />
    );

    // The bug: onRefreshIndexers should be called automatically when the component mounts
    // IF prowlarr URL and API key are configured
    await waitFor(() => {
      expect(mockOnRefreshIndexers).toHaveBeenCalledTimes(1);
    }, { timeout: 1000 });
  });

  it('should NOT auto-fetch indexers if prowlarr URL is missing', async () => {
    const mockOnRefreshIndexers = vi.fn().mockResolvedValue(undefined);
    const settingsWithoutUrl = {
      ...mockSettings,
      prowlarr: { url: '', apiKey: 'test-api-key' },
    };

    render(
      <IndexersTab
        settings={settingsWithoutUrl}
        indexers={[]}
        flagConfigs={mockFlagConfigs}
        onChange={vi.fn()}
        onIndexersChange={vi.fn()}
        onFlagConfigsChange={vi.fn()}
        onValidationChange={vi.fn()}
        onRefreshIndexers={mockOnRefreshIndexers}
      />
    );

    // Should NOT call onRefreshIndexers because URL is missing
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockOnRefreshIndexers).not.toHaveBeenCalled();
  });

  it('should NOT auto-fetch indexers if prowlarr API key is missing', async () => {
    const mockOnRefreshIndexers = vi.fn().mockResolvedValue(undefined);
    const settingsWithoutApiKey = {
      ...mockSettings,
      prowlarr: { url: 'http://prowlarr.local:9696', apiKey: '' },
    };

    render(
      <IndexersTab
        settings={settingsWithoutApiKey}
        indexers={[]}
        flagConfigs={mockFlagConfigs}
        onChange={vi.fn()}
        onIndexersChange={vi.fn()}
        onFlagConfigsChange={vi.fn()}
        onValidationChange={vi.fn()}
        onRefreshIndexers={mockOnRefreshIndexers}
      />
    );

    // Should NOT call onRefreshIndexers because API key is missing
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mockOnRefreshIndexers).not.toHaveBeenCalled();
  });
});
