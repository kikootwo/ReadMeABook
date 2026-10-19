/**
 * Component: Admin Settings Helpers Tests
 * Documentation: documentation/settings-pages.md
 */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/api', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

const makeOk = () => ({ ok: true });
const makeFail = () => ({ ok: false });

const baseSettings = {
  backendMode: 'plex',
  hasLocalUsers: true,
  hasLocalAdmins: true,
  audibleRegion: 'us',
  audibleLanguageFilter: false,
  plex: { url: 'http://plex', token: 'token', libraryId: 'lib', triggerScanAfterImport: false },
  audiobookshelf: { serverUrl: 'http://abs', apiToken: 'abs-token', libraryId: 'abs-lib', triggerScanAfterImport: false },
  oidc: {
    enabled: true,
    providerName: 'OIDC',
    issuerUrl: 'http://issuer',
    clientId: 'client',
    clientSecret: 'secret',
    accessControlMethod: 'open',
    accessGroupClaim: 'groups',
    accessGroupValue: '',
    allowedEmails: 'first@example.com, second@example.com',
    allowedUsernames: 'alpha, beta',
    adminClaimEnabled: false,
    adminClaimName: 'groups',
    adminClaimValue: '',
  },
  registration: { enabled: true, requireAdminApproval: false },
  prowlarr: { url: 'http://prowlarr', apiKey: 'key' },
  indexerOptions: { skipUnreleased: true },
  downloadClient: {
    type: 'qbittorrent',
    url: 'http://qb',
    username: 'user',
    password: 'pass',
    disableSSLVerify: false,
    remotePathMappingEnabled: false,
    remotePath: '',
    localPath: '',
  },
  paths: {
    downloadDir: '/downloads',
    mediaDir: '/media',
    audiobookPathTemplate: '',
    ebookPathTemplate: '',
    metadataTaggingEnabled: true,
    chapterMergingEnabled: false,
  },
  ebook: { enabled: false, preferredFormat: '', baseUrl: '', flaresolverrUrl: '' },
};

describe('admin settings helpers', () => {
  it('parses array strings to comma-separated values', async () => {
    const { parseArrayToCommaSeparated } = await import('@/app/admin/settings/lib/helpers');
    expect(parseArrayToCommaSeparated('["a","b"]')).toBe('a, b');
    expect(parseArrayToCommaSeparated('not-json')).toBe('');
  });

  it('parses comma-separated strings into JSON arrays', async () => {
    const { parseCommaSeparatedToArray } = await import('@/app/admin/settings/lib/helpers');
    expect(parseCommaSeparatedToArray('alpha, beta')).toBe('["alpha","beta"]');
    expect(parseCommaSeparatedToArray('')).toBe('[]');
  });

  it('validates auth settings when no auth methods are enabled', async () => {
    const { validateAuthSettings } = await import('@/app/admin/settings/lib/helpers');
    const result = validateAuthSettings({
      ...baseSettings,
      backendMode: 'audiobookshelf',
      hasLocalUsers: false,
      hasLocalAdmins: false,
      oidc: { ...baseSettings.oidc, enabled: false },
      registration: { enabled: false, requireAdminApproval: false },
    });
    expect(result.valid).toBe(false);
    expect(result.message).toContain('At least one authentication method must be enabled');
  });

  it('prevents saving when manual registration is enabled but no admin users exist', async () => {
    const { validateAuthSettings } = await import('@/app/admin/settings/lib/helpers');
    const result = validateAuthSettings({
      ...baseSettings,
      backendMode: 'audiobookshelf',
      hasLocalUsers: false,
      hasLocalAdmins: false,
      oidc: { ...baseSettings.oidc, enabled: false },
      registration: { enabled: true, requireAdminApproval: false },
    });
    expect(result.valid).toBe(false);
    expect(result.message).toContain('no local admin users exist');
  });

  it('allows saving when manual registration is enabled and admin users exist', async () => {
    const { validateAuthSettings } = await import('@/app/admin/settings/lib/helpers');
    const result = validateAuthSettings({
      ...baseSettings,
      backendMode: 'audiobookshelf',
      hasLocalUsers: true,
      hasLocalAdmins: true,
      oidc: { ...baseSettings.oidc, enabled: false },
      registration: { enabled: true, requireAdminApproval: false },
    });
    expect(result.valid).toBe(true);
  });

  it('allows saving when OIDC is enabled even without local admin users', async () => {
    const { validateAuthSettings } = await import('@/app/admin/settings/lib/helpers');
    const result = validateAuthSettings({
      ...baseSettings,
      backendMode: 'audiobookshelf',
      hasLocalUsers: false,
      hasLocalAdmins: false,
      oidc: { ...baseSettings.oidc, enabled: true },
      registration: { enabled: false, requireAdminApproval: false },
    });
    expect(result.valid).toBe(true);
  });

  it('returns tab validation based on backend mode and changes', async () => {
    const { getTabValidation } = await import('@/app/admin/settings/lib/helpers');
    const validated = {
      plex: true,
      audiobookshelf: false,
      oidc: false,
      registration: false,
      prowlarr: false,
      download: true,
      paths: true,
    };

    expect(getTabValidation('library', baseSettings, baseSettings, validated)).toBe(true);
    expect(getTabValidation('download', baseSettings, baseSettings, validated)).toBe(true);

    const changed = { ...baseSettings, prowlarr: { url: 'new', apiKey: 'key' } };
    expect(getTabValidation('prowlarr', changed, baseSettings, validated)).toBe(false);
  });

  it('returns true for auth tab when OIDC is disabled', async () => {
    const { getTabValidation } = await import('@/app/admin/settings/lib/helpers');
    const validated = {
      plex: false,
      audiobookshelf: false,
      oidc: false,
      registration: false,
      prowlarr: false,
      download: false,
      paths: false,
    };

    const settingsWithOidcDisabled = {
      ...baseSettings,
      oidc: { ...baseSettings.oidc, enabled: false },
    };

    expect(getTabValidation('auth', settingsWithOidcDisabled, baseSettings, validated)).toBe(true);
  });

  it('returns false for auth tab when OIDC is enabled but not validated', async () => {
    const { getTabValidation } = await import('@/app/admin/settings/lib/helpers');
    const validated = {
      plex: false,
      audiobookshelf: false,
      oidc: false,
      registration: false,
      prowlarr: false,
      download: false,
      paths: false,
    };

    expect(getTabValidation('auth', baseSettings, baseSettings, validated)).toBe(false);
  });

  it('returns true for auth tab when OIDC is enabled and validated', async () => {
    const { getTabValidation } = await import('@/app/admin/settings/lib/helpers');
    const validated = {
      plex: false,
      audiobookshelf: false,
      oidc: true,
      registration: false,
      prowlarr: false,
      download: false,
      paths: false,
    };

    expect(getTabValidation('auth', baseSettings, baseSettings, validated)).toBe(true);
  });

  it('returns auth tabs for audiobookshelf mode', async () => {
    const { getTabs } = await import('@/app/admin/settings/lib/helpers');
    const absTabs = getTabs('audiobookshelf').map((tab) => tab.id);
    const plexTabs = getTabs('plex').map((tab) => tab.id);

    expect(absTabs).toContain('auth');
    expect(plexTabs).not.toContain('auth');
  });

  it('saves plex settings when library tab is active', async () => {
    fetchWithAuthMock
      .mockResolvedValueOnce(makeOk())
      .mockResolvedValueOnce(makeOk());

    const { saveTabSettings } = await import('@/app/admin/settings/lib/helpers');
    await saveTabSettings('library', baseSettings, [], []);

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/admin/settings/audible',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ region: 'us', languageFilter: false }),
      })
    );
    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/admin/settings/plex',
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('saves audiobookshelf settings when library tab is active', async () => {
    fetchWithAuthMock
      .mockResolvedValueOnce(makeOk())
      .mockResolvedValueOnce(makeOk());

    const { saveTabSettings } = await import('@/app/admin/settings/lib/helpers');
    await saveTabSettings('library', { ...baseSettings, backendMode: 'audiobookshelf' }, [], []);

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/admin/settings/audiobookshelf',
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('saves auth settings with converted allowed lists', async () => {
    fetchWithAuthMock
      .mockResolvedValueOnce(makeOk())
      .mockResolvedValueOnce(makeOk());

    const { saveTabSettings } = await import('@/app/admin/settings/lib/helpers');
    await saveTabSettings('auth', baseSettings, [], []);

    const oidcBody = JSON.parse((fetchWithAuthMock.mock.calls[0][1] as RequestInit).body as string);
    expect(oidcBody.allowedEmails).toBe('["first@example.com","second@example.com"]');
    expect(oidcBody.allowedUsernames).toBe('["alpha","beta"]');
  });

  it('saves OIDC settings even when disabled', async () => {
    fetchWithAuthMock
      .mockResolvedValueOnce(makeOk())
      .mockResolvedValueOnce(makeOk());

    const { saveTabSettings } = await import('@/app/admin/settings/lib/helpers');
    const settingsWithOidcDisabled = {
      ...baseSettings,
      oidc: { ...baseSettings.oidc, enabled: false },
    };
    await saveTabSettings('auth', settingsWithOidcDisabled, [], []);

    // Verify OIDC endpoint is called even when disabled
    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/admin/settings/oidc',
      expect.objectContaining({ method: 'PUT' })
    );

    const oidcBody = JSON.parse((fetchWithAuthMock.mock.calls[0][1] as RequestInit).body as string);
    expect(oidcBody.enabled).toBe(false);
  });

  it('saves prowlarr settings with enabled indexers and flag configs', async () => {
    fetchWithAuthMock
      .mockResolvedValueOnce(makeOk())
      .mockResolvedValueOnce(makeOk())
      .mockResolvedValueOnce(makeOk());

    const { saveTabSettings } = await import('@/app/admin/settings/lib/helpers');
    await saveTabSettings(
      'prowlarr',
      baseSettings,
      [{ id: 1, name: 'Idx', protocol: 'torrent', priority: 1, seedingTimeMinutes: 10, rssEnabled: true, categories: [3030] }],
      [{ id: 'flag-1', name: 'Flag', weight: 1 }]
    );

    const body = JSON.parse((fetchWithAuthMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body.indexers[0].enabled).toBe(true);
    expect(body.flagConfigs).toHaveLength(1);

    // Indexer options PUT goes last in the prowlarr tab save flow.
    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/admin/settings/indexer-options',
      expect.objectContaining({ method: 'PUT' })
    );
    const optionsBody = JSON.parse(
      (fetchWithAuthMock.mock.calls[2][1] as RequestInit).body as string
    );
    expect(optionsBody.skipUnreleased).toBe(true);
  });

  it('saves download and paths settings', async () => {
    fetchWithAuthMock.mockResolvedValue(makeOk());

    const { saveTabSettings } = await import('@/app/admin/settings/lib/helpers');
    await saveTabSettings('download', baseSettings, [], []);
    await saveTabSettings('paths', baseSettings, [], []);

    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/admin/settings/download-client',
      expect.objectContaining({ method: 'PUT' })
    );
    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/api/admin/settings/paths',
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('throws for unsupported tab types', async () => {
    const { saveTabSettings } = await import('@/app/admin/settings/lib/helpers');
    await expect(saveTabSettings('ebook', baseSettings, [], [])).rejects.toThrow('Unknown settings tab');
  });

  it('throws when a save request fails', async () => {
    fetchWithAuthMock
      .mockResolvedValueOnce(makeFail());

    const { saveTabSettings } = await import('@/app/admin/settings/lib/helpers');
    await expect(saveTabSettings('library', baseSettings, [], [])).rejects.toThrow('Failed to save Audible region');
  });
});
