/**
 * Component: Admin Settings Page Tests
 * Documentation: documentation/settings-pages.md
 */

// @vitest-environment jsdom

import React from 'react';
import path from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());
const saveTabSettingsMock = vi.hoisted(() => vi.fn());
const getTabValidationMock = vi.hoisted(() => vi.fn());
const getTabsMock = vi.hoisted(() => vi.fn());
const parseArrayToCommaSeparatedMock = vi.hoisted(() => vi.fn((value: string) => value));

vi.mock('@/lib/utils/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

const mockAdminSettingsModules = () => {
  vi.doMock(path.resolve('src/app/admin/settings/lib/helpers.ts'), () => ({
    parseArrayToCommaSeparated: parseArrayToCommaSeparatedMock,
    saveTabSettings: saveTabSettingsMock,
    validateAuthSettings: vi.fn(() => ({ valid: true })),
    getTabValidation: getTabValidationMock,
    getTabs: getTabsMock,
  }));

  vi.doMock(path.resolve('src/app/admin/settings/tabs/LibraryTab/LibraryTab.tsx'), () => ({
    LibraryTab: ({ settings, onChange }: { settings: any; onChange: (next: any) => void }) => (
      <div>
        <div>Library Tab</div>
        <button type="button" onClick={() => onChange({ ...settings, audibleRegion: 'uk' })}>
          Change Settings
        </button>
      </div>
    ),
  }));

  vi.doMock(path.resolve('src/app/admin/settings/tabs/AuthTab/AuthTab.tsx'), () => ({
    AuthTab: () => <div>Auth Tab</div>,
  }));

  vi.doMock(path.resolve('src/app/admin/settings/tabs/IndexersTab/IndexersTab.tsx'), () => ({
    IndexersTab: () => <div>Indexers Tab</div>,
  }));

  vi.doMock(path.resolve('src/app/admin/settings/tabs/DownloadTab/DownloadTab.tsx'), () => ({
    DownloadTab: () => <div>Download Tab</div>,
  }));

  vi.doMock(path.resolve('src/app/admin/settings/tabs/PathsTab/PathsTab.tsx'), () => ({
    PathsTab: () => <div>Paths Tab</div>,
  }));

  vi.doMock(path.resolve('src/app/admin/settings/tabs/EbookTab/EbookTab.tsx'), () => ({
    EbookTab: () => <div>Ebook Tab</div>,
  }));

  vi.doMock(path.resolve('src/app/admin/settings/tabs/BookDateTab/BookDateTab.tsx'), () => ({
    BookDateTab: () => <div>BookDate Tab</div>,
  }));

  vi.doMock(path.resolve('src/app/admin/settings/tabs/NotificationsTab/index.tsx'), () => ({
    NotificationsTab: () => <div>Notifications Tab</div>,
  }));
};

const settingsFixture = {
  backendMode: 'plex',
  hasLocalUsers: true,
  audibleRegion: 'us',
  plex: { url: '', token: '', libraryId: '', triggerScanAfterImport: false },
  audiobookshelf: { serverUrl: '', apiToken: '', libraryId: '', triggerScanAfterImport: false },
  oidc: {
    enabled: false,
    providerName: '',
    issuerUrl: '',
    clientId: '',
    clientSecret: '',
    accessControlMethod: 'open',
    accessGroupClaim: 'groups',
    accessGroupValue: '',
    allowedEmails: '[]',
    allowedUsernames: '[]',
    adminClaimEnabled: false,
    adminClaimName: 'groups',
    adminClaimValue: '',
  },
  registration: { enabled: false, requireAdminApproval: false },
  prowlarr: { url: '', apiKey: '' },
  downloadClient: {
    type: 'qbittorrent',
    url: '',
    username: '',
    password: '',
    disableSSLVerify: false,
    remotePathMappingEnabled: false,
    remotePath: '',
    localPath: '',
  },
  paths: {
    downloadDir: '',
    mediaDir: '',
    audiobookPathTemplate: '',
    metadataTaggingEnabled: true,
    chapterMergingEnabled: false,
  },
  ebook: { enabled: false, preferredFormat: '', baseUrl: '', flaresolverrUrl: '' },
};

describe('AdminSettings', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    saveTabSettingsMock.mockReset();
    getTabValidationMock.mockReset();
    getTabsMock.mockReset();
    parseArrayToCommaSeparatedMock.mockReset();
    vi.resetModules();
    mockAdminSettingsModules();
  });

  it('fetches settings and renders the settings shell', async () => {
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => settingsFixture,
    });
    getTabValidationMock.mockReturnValue(true);
    getTabsMock.mockReturnValue([{ id: 'library', label: 'Library', icon: 'L' }]);

    const { default: AdminSettings } = await import('@/app/admin/settings/page');
    render(<AdminSettings />);

    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/admin/settings');
  });

  it('saves settings when changes are made and validation passes', async () => {
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => settingsFixture,
    });
    getTabValidationMock.mockReturnValue(true);
    getTabsMock.mockReturnValue([{ id: 'library', label: 'Library', icon: 'L' }]);

    const { default: AdminSettings } = await import('@/app/admin/settings/page');
    render(<AdminSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Change Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Settings' }));

    await waitFor(() => {
      expect(saveTabSettingsMock).toHaveBeenCalledWith(
        'library',
        expect.objectContaining({ audibleRegion: 'uk' }),
        [],
        []
      );
    });
  });
});
