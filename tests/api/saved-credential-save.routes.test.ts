/**
 * Component: Saved Credential Rule on Settings Save Routes
 * Documentation: documentation/settings-pages.md
 *
 * Saving with a masked secret keeps the saved secret only when the URL stays the
 * saved URL; a new address needs the secret re-entered (400, nothing saved).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const MASK = '••••••••';
const config = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));
const upsertMock = vi.hoisted(() => vi.fn());
const setManyMock = vi.hoisted(() => vi.fn());
const clearCacheMock = vi.hoisted(() => vi.fn());
const plexTestMock = vi.hoisted(() => vi.fn());
const managerMock = vi.hoisted(() => ({ getAllClients: vi.fn(), testConnection: vi.fn() }));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: unknown, handler: (r: unknown) => unknown) => handler(req),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/db', () => ({ prisma: { configuration: { upsert: upsertMock } } }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ get: async (key: string) => config.values[key] ?? null, setMany: setManyMock, clearCache: clearCacheMock }),
}));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({
    encrypt: (v: string) => `enc:${v}`,
    isEncryptedFormat: (v: string) => typeof v === 'string' && v.startsWith('enc:'),
    // "enc:undecryptable" stands for ciphertext from another key; other enc: values decrypt
    decrypt: (v: string) => {
      if (v === 'enc:undecryptable') throw new Error('bad auth tag');
      return v.slice('enc:'.length);
    },
  }),
}));
vi.mock('@/lib/integrations/plex.service', () => ({ getPlexService: () => ({ testConnection: plexTestMock }) }));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ invalidateProwlarrService: () => undefined }));
vi.mock('@/lib/integrations/qbittorrent.service', () => ({ invalidateQBittorrentService: () => undefined }));
vi.mock('@/lib/services/download-client-manager.service', () => ({
  getDownloadClientManager: () => managerMock,
  invalidateDownloadClientManager: () => undefined,
}));

const json = (body: unknown) => ({ json: async () => body }) as any;
const savedKeys = () => upsertMock.mock.calls.map(([args]) => args.where.key);
const savedClient = { id: 'c1', type: 'qbittorrent', name: 'qBittorrent', enabled: true, url: 'http://qbit.saved:8080', username: 'u', password: 'saved-pass' };

describe('settings save routes keep a saved secret only for the saved URL', () => {
  beforeEach(() => {
    config.values = {
      plex_token: 'saved-plex', plex_url: 'http://plex.saved:32400',
      prowlarr_api_key: 'saved-prowlarr', prowlarr_url: 'http://prowlarr.saved:9696',
      'audiobookshelf.api_token': 'saved-abs', 'audiobookshelf.server_url': 'http://abs.saved:13378',
    };
    plexTestMock.mockResolvedValue({ success: true, info: { machineIdentifier: 'm1' } });
    managerMock.getAllClients.mockResolvedValue([{ ...savedClient }]);
    managerMock.testConnection.mockResolvedValue({ success: true });
  });

  describe('PUT /api/admin/settings/plex', () => {
    it('rejects a masked token with a new URL and saves nothing', async () => {
      const { PUT } = await import('@/app/api/admin/settings/plex/route');
      const response = await PUT(json({ url: 'http://elsewhere:32400', token: MASK, libraryId: '1' }));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('Plex token');
      expect(upsertMock).not.toHaveBeenCalled();
      expect(plexTestMock).not.toHaveBeenCalled();
    });

    it('rejects a non-string token without saving anything', async () => {
      const { PUT } = await import('@/app/api/admin/settings/plex/route');
      const response = await PUT(json({ url: 'http://elsewhere:32400', token: 1, libraryId: '1' }));

      expect(response.status).toBe(400);
      expect(upsertMock).not.toHaveBeenCalled();
    });

    it('keeps the saved token for the saved URL', async () => {
      const { PUT } = await import('@/app/api/admin/settings/plex/route');
      const response = await PUT(json({ url: 'http://plex.saved:32400/', token: MASK, libraryId: '1' }));

      expect(response.status).toBe(200);
      expect(savedKeys()).not.toContain('plex_token');
      expect(plexTestMock).toHaveBeenCalledWith('http://plex.saved:32400/', 'saved-plex');
      expect(clearCacheMock).toHaveBeenCalledWith('plex_url');
      expect(clearCacheMock).toHaveBeenCalledWith('plex_token');
    });
  });

  describe('PUT /api/admin/settings/prowlarr', () => {
    it('rejects a masked key with a new URL and saves nothing', async () => {
      const { PUT } = await import('@/app/api/admin/settings/prowlarr/route');
      const response = await PUT(json({ url: 'http://elsewhere:9696', apiKey: MASK }));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('Prowlarr API key');
      expect(upsertMock).not.toHaveBeenCalled();
    });

    it('rejects a non-string key without saving anything', async () => {
      const { PUT } = await import('@/app/api/admin/settings/prowlarr/route');
      const response = await PUT(json({ url: 'http://elsewhere:9696', apiKey: 1 }));

      expect(response.status).toBe(400);
      expect(upsertMock).not.toHaveBeenCalled();
    });

    it('keeps the saved key for the saved URL', async () => {
      const { PUT } = await import('@/app/api/admin/settings/prowlarr/route');
      const response = await PUT(json({ url: 'http://prowlarr.saved:9696/', apiKey: MASK }));

      expect(response.status).toBe(200);
      expect(savedKeys()).toEqual(['prowlarr_url']);
      expect(clearCacheMock).toHaveBeenCalledWith('prowlarr_api_key');
    });

    it('accepts a new key with a new URL', async () => {
      const { PUT } = await import('@/app/api/admin/settings/prowlarr/route');
      const response = await PUT(json({ url: 'http://elsewhere:9696', apiKey: 'new-key' }));

      expect(response.status).toBe(200);
      expect(savedKeys()).toEqual(['prowlarr_url', 'prowlarr_api_key']);
    });
  });

  describe('PUT /api/admin/settings/audiobookshelf', () => {
    it('rejects a masked token with a new URL and saves nothing', async () => {
      const { PUT } = await import('@/app/api/admin/settings/audiobookshelf/route');
      const response = await PUT(json({ serverUrl: 'http://elsewhere:13378', apiToken: MASK, libraryId: 'l' }));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('Audiobookshelf API token');
      expect(setManyMock).not.toHaveBeenCalled();
    });

    it.each([
      ['an empty token', { apiToken: '' }],
      ['an omitted token', {}],
    ])('rejects %s with a new URL and saves nothing', async (_label, token) => {
      const { PUT } = await import('@/app/api/admin/settings/audiobookshelf/route');
      const response = await PUT(json({ serverUrl: 'http://elsewhere:13378', libraryId: 'l', ...token }));

      expect(response.status).toBe(400);
      expect(setManyMock).not.toHaveBeenCalled();
    });

    it('disconnects when both URL and token are cleared', async () => {
      const { PUT } = await import('@/app/api/admin/settings/audiobookshelf/route');
      const response = await PUT(json({ serverUrl: '', apiToken: '', libraryId: '' }));

      expect(response.status).toBe(200);
      const updates = setManyMock.mock.calls[0][0];
      expect(updates).toEqual(expect.arrayContaining([
        expect.objectContaining({ key: 'audiobookshelf.server_url', value: '' }),
        expect.objectContaining({ key: 'audiobookshelf.api_token', value: '' }),
      ]));
    });

    it('keeps the saved token for the saved URL', async () => {
      const { PUT } = await import('@/app/api/admin/settings/audiobookshelf/route');
      const response = await PUT(json({ serverUrl: 'http://abs.saved:13378', apiToken: MASK, libraryId: 'l' }));

      expect(response.status).toBe(200);
      const keys = setManyMock.mock.calls[0][0].map((u: { key: string }) => u.key);
      expect(keys).not.toContain('audiobookshelf.api_token');
    });
  });

  describe('PUT /api/admin/settings/download-clients/[id]', () => {
    const put = async (body: Record<string, unknown>) => {
      const { PUT } = await import('@/app/api/admin/settings/download-clients/[id]/route');
      return PUT(json(body), { params: Promise.resolve({ id: 'c1' }) });
    };

    it.each([
      ['the masked password', { url: 'http://elsewhere:8080', password: '********' }],
      ['no password', { url: 'http://elsewhere:8080' }],
    ])('rejects a new URL with %s, without testing or saving', async (_label, body) => {
      const response = await put(body);

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('download client password or API key');
      expect(managerMock.testConnection).not.toHaveBeenCalled();
      expect(setManyMock).not.toHaveBeenCalled();
    });

    it('tests a new URL with a newly entered password', async () => {
      const response = await put({ url: 'http://elsewhere:8080', password: 'new-pass' });

      expect(response.status).toBe(200);
      expect(managerMock.testConnection).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://elsewhere:8080', password: 'new-pass' }));
    });

    it('keeps the saved password when the URL is unchanged', async () => {
      const response = await put({ name: 'Renamed', password: '********' });

      expect(response.status).toBe(200);
      const stored = JSON.parse(setManyMock.mock.calls[0][0][0].value);
      expect(stored[0].password).toBe('enc:saved-pass');
    });

    it('does not re-encrypt a password the manager could not decrypt', async () => {
      managerMock.getAllClients.mockResolvedValue([
        { ...savedClient },
        { id: 'c2', type: 'sabnzbd', name: 'SABnzbd', enabled: true, url: 'http://sab:8080', password: 'enc:undecryptable' },
      ]);
      const response = await put({ name: 'Renamed', password: '********' });

      expect(response.status).toBe(200);
      const stored = JSON.parse(setManyMock.mock.calls[0][0][0].value);
      expect(stored.map((c: { password: string }) => c.password)).toEqual(['enc:saved-pass', 'enc:undecryptable']);
    });
  });

  describe('PUT /api/admin/settings/download-client (legacy)', () => {
    it('keeps the saved password at the same URL', async () => {
      const { PUT } = await import('@/app/api/admin/settings/download-client/route');
      const response = await PUT(json({ type: 'qbittorrent', url: 'http://qbit.saved:8080/', username: 'u', password: MASK }));

      expect(response.status).toBe(200);
      expect(setManyMock).toHaveBeenCalled();
      const stored = JSON.parse(setManyMock.mock.calls[0][0][0].value);
      expect(stored[0].password).toBe('enc:saved-pass');
    });

    it('stores every client password encrypted, not just the edited one', async () => {
      managerMock.getAllClients.mockResolvedValue([
        { ...savedClient },
        { id: 'c2', type: 'sabnzbd', name: 'SABnzbd', enabled: true, url: 'http://sab:8080', password: 'canary-plain' },
      ]);
      const { PUT } = await import('@/app/api/admin/settings/download-client/route');
      const response = await PUT(json({ type: 'qbittorrent', url: 'http://qbit.saved:8080', username: 'u', password: 'new-pass' }));

      expect(response.status).toBe(200);
      const stored = JSON.parse(setManyMock.mock.calls[0][0][0].value);
      expect(stored.map((c: { password: string }) => c.password)).toEqual(['enc:new-pass', 'enc:canary-plain']);
    });

    it('rejects a masked password with a new URL and saves nothing', async () => {
      const { PUT } = await import('@/app/api/admin/settings/download-client/route');
      const response = await PUT(json({ type: 'qbittorrent', url: 'http://elsewhere:8080', username: 'u', password: MASK }));

      expect(response.status).toBe(400);
      expect(setManyMock).not.toHaveBeenCalled();
    });
  });
});
