/**
 * Component: Admin Settings Page Tests
 * Documentation: documentation/settings-pages.md
 */

// @vitest-environment jsdom

import React from 'react';
import path from 'path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    LibraryTab: ({ settings, onChange, onSuccess }: { settings: any; onChange: (next: any) => void; onSuccess: (msg: string) => void }) => (
      <div>
        <div>Library Tab</div>
        <button type="button" onClick={() => onChange({ ...settings, audibleRegion: 'uk' })}>
          Change Settings
        </button>
        <button type="button" onClick={() => onSuccess('Connected to Plex. You can now save.')}>
          Test Connection
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
    ebookPathTemplate: '',
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
        [],
        { indexerPlan: { saveIndexers: false, allowEmpty: false, saveFlags: false } }
      );
    });
  });

  it('clears the success banner after 3 s and leaves no timer when unmounted earlier', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchWithAuthMock.mockResolvedValue({ ok: true, json: async () => settingsFixture });
    getTabValidationMock.mockReturnValue(true);
    getTabsMock.mockReturnValue([{ id: 'library', label: 'Library', icon: 'L' }]);
    saveTabSettingsMock.mockResolvedValue(undefined);

    const { default: AdminSettings } = await import('@/app/admin/settings/page');
    const first = render(<AdminSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Settings' }));
    expect(await screen.findByText('Settings saved successfully!')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByText('Settings saved successfully!')).not.toBeInTheDocument();
    first.unmount();

    // Unmounted while the banner is up: its timer is cancelled, not left to fire
    render(<AdminSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Settings' }));
    await screen.findByText('Settings saved successfully!');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    cleanup();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
    vi.useRealTimers();
  });

  it('keeps a test-connection success on screen (it says what to do next)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchWithAuthMock.mockResolvedValue({ ok: true, json: async () => settingsFixture });
    getTabValidationMock.mockReturnValue(true);
    getTabsMock.mockReturnValue([{ id: 'library', label: 'Library', icon: 'L' }]);

    const { default: AdminSettings } = await import('@/app/admin/settings/page');
    render(<AdminSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test Connection' }));
    expect(await screen.findByText('Connected to Plex. You can now save.')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.getByText('Connected to Plex. You can now save.')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
