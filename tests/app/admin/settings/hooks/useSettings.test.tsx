/**
 * Component: Admin Settings Global Hook Tests
 * Documentation: documentation/settings-pages.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

const renderHook = <T,>(hook: () => T) => {
  const result = { current: undefined as T };
  function Probe() {
    result.current = hook();
    return null;
  }
  render(<Probe />);
  return result;
};

const baseSettings = {
  backendMode: 'plex',
  hasLocalUsers: true,
  audibleRegion: 'us',
  audibleLanguageFilter: false,
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
    allowedEmails: '["first@example.com","second@example.com"]',
    allowedUsernames: '["alpha","beta"]',
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

describe('useSettings', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
  });

  it('loads settings and converts OIDC lists to comma-separated strings', async () => {
    fetchWithAuthMock.mockResolvedValueOnce({
      ok: true,
      json: async () => baseSettings,
    });

    const { useSettings } = await import('@/app/admin/settings/hooks/useSettings');
    const result = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.settings?.oidc.allowedEmails).toBe('first@example.com, second@example.com');
    expect(result.current.settings?.oidc.allowedUsernames).toBe('alpha, beta');
    expect(fetchWithAuthMock).toHaveBeenCalledWith('/api/admin/settings');
  });

  it('tracks changes, resets, and marks settings as saved', async () => {
    fetchWithAuthMock.mockResolvedValueOnce({
      ok: true,
      json: async () => baseSettings,
    });

    const { useSettings } = await import('@/app/admin/settings/hooks/useSettings');
    const result = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.settings).not.toBeNull());

    act(() => {
      result.current.updateSettings({ audibleRegion: 'uk' });
    });

    expect(result.current.hasUnsavedChanges()).toBe(true);

    act(() => {
      result.current.resetSettings();
    });

    expect(result.current.settings?.audibleRegion).toBe('us');
    expect(result.current.hasUnsavedChanges()).toBe(false);

    act(() => {
      result.current.updateSettings((prev) => ({ ...prev, audibleRegion: 'ca' }));
    });

    expect(result.current.hasUnsavedChanges()).toBe(true);

    act(() => {
      result.current.markAsSaved();
    });

    expect(result.current.hasUnsavedChanges()).toBe(false);
  });

  it('updates validation, test results, and message state', async () => {
    fetchWithAuthMock.mockResolvedValueOnce({
      ok: true,
      json: async () => baseSettings,
    });

    const { useSettings } = await import('@/app/admin/settings/hooks/useSettings');
    const result = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.settings).not.toBeNull());

    act(() => {
      result.current.updateValidation('plex', true);
      result.current.updateTestResults('plex', { success: true, message: 'ok' });
      result.current.showMessage({ type: 'success', text: 'Saved' });
    });

    expect(result.current.validated.plex).toBe(true);
    expect(result.current.testResults.plex).toEqual({ success: true, message: 'ok' });
    expect(result.current.message?.text).toBe('Saved');

    act(() => {
      result.current.clearMessage();
    });

    expect(result.current.message).toBeNull();
  });
});
