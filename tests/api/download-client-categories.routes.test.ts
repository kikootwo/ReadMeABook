/**
 * Component: Download Client Category Routes (lists and ownership on save)
 * Documentation: documentation/phase3/download-clients.md
 *
 * Runs the real DownloadClientManager with the client classes faked by URL. Category lists must
 * come from a fresh service (the cache is keyed by id), and ownership is decided on save.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ values: {} as Record<string, string | null>, setMany: vi.fn() }));
const fake = vi.hoisted(() => ({
  lists: {} as Record<string, string[] | Error>,
  listed: [] as string[],
  built: [] as Array<{ type: string; url: string; category: string; owned: boolean | undefined }>,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: unknown, handler: (r: unknown) => unknown) => handler(req),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
  requireSetupIncomplete: (req: unknown, handler: (r: unknown) => unknown) => handler(req),
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    get: async (key: string) => store.values[key] ?? null,
    setMany: async (entries: Array<{ key: string; value: string }>) => {
      store.setMany(entries);
      for (const { key, value } of entries) store.values[key] = value;
    },
  }),
}));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({
    encrypt: (v: string) => `enc:${v}`,
    isEncryptedFormat: (v: string) => typeof v === 'string' && v.startsWith('enc:'),
    decrypt: (v: string) => v.slice('enc:'.length),
  }),
}));

vi.mock('@/lib/integrations/qbittorrent.service', () => ({
  QBittorrentService: class {
    constructor(public url: string, _u: string, _p: string, _dir: string, category: string, _ssl: boolean, _pm: unknown, owned?: boolean) {
      fake.built.push({ type: 'qbittorrent', url, category, owned });
    }
    async testConnection() { return { success: true }; }
    async getCategories() { return fakeList(this.url); }
  },
  invalidateQBittorrentService: () => undefined,
}));
vi.mock('@/lib/integrations/sabnzbd.service', () => ({
  SABnzbdService: class {
    constructor(public url: string, _key: string, category: string, _dir: string, _ssl: boolean, _pm: unknown, owned?: boolean) {
      fake.built.push({ type: 'sabnzbd', url, category, owned });
    }
    async testConnection() { return { success: true }; }
    async getCategories() { return fakeList(this.url); }
  },
}));
vi.mock('@/lib/integrations/nzbget.service', () => ({ NZBGetService: class {} }));
vi.mock('@/lib/integrations/transmission.service', () => ({ TransmissionService: class {} }));
vi.mock('@/lib/integrations/deluge.service', () => ({ DelugeService: class {} }));

function fakeList(url: string): string[] {
  fake.listed.push(url);
  const answer = fake.lists[url];
  if (answer instanceof Error) throw answer;
  return answer ?? [];
}

const req = (body: unknown) => ({ json: async () => body, headers: new Headers({ 'content-type': 'application/json' }) }) as never;
const stored = () => JSON.parse(store.values.download_clients || '[]');
const qbit = { type: 'qbittorrent', name: 'qBittorrent', url: 'http://qbit:8080', username: 'u', password: 'p' };
const sab = { type: 'sabnzbd', name: 'SABnzbd', url: 'http://sab:8081', password: 'key' };

describe('download client category routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    store.values = { download_dir: '/downloads' };
    fake.lists = { 'http://qbit:8080': ['Books', 'movies'], 'http://sab:8081': ['books', 'tv'], 'http://qbit2:8080': ['audiobooks'] };
    fake.listed = [];
    fake.built = [];
    const { invalidateDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
    invalidateDownloadClientManager();
  });

  describe('category lists come from a fresh service, never the cache', () => {
    it('setup wizard: qBittorrent then SABnzbd lists return SABnzbd\'s names', async () => {
      const { POST } = await import('@/app/api/setup/download-client-categories/route');
      expect((await (await POST(req(qbit))).json()).categories).toEqual(['Books', 'movies']);
      expect((await (await POST(req(sab))).json()).categories).toEqual(['books', 'tv']);
    });

    it('settings: qBittorrent then SABnzbd lists return SABnzbd\'s names', async () => {
      const { POST } = await import('@/app/api/admin/settings/download-clients/categories/route');
      expect((await (await POST(req(qbit))).json()).categories).toEqual(['Books', 'movies']);
      expect((await (await POST(req(sab))).json()).categories).toEqual(['books', 'tv']);
    });
  });

  describe('POST (add)', () => {
    it('a new name missing in the client is saved as ReadMeABook\'s own', async () => {
      const { POST } = await import('@/app/api/admin/settings/download-clients/route');
      const res = await POST(req({ ...qbit, category: ' audiobooks-rmab ' }));
      expect(res.status).toBe(200);
      expect(stored()[0]).toMatchObject({ category: 'audiobooks-rmab', ownedCategory: 'audiobooks-rmab' });
    });

    it('a name already in the client is stored in its spelling, with no ownership', async () => {
      const { POST } = await import('@/app/api/admin/settings/download-clients/route');
      await POST(req({ ...qbit, category: 'books' }));
      expect(stored()[0].category).toBe('Books');
      expect(stored()[0]).not.toHaveProperty('ownedCategory');
    });

    it('the default needs no list call', async () => {
      const { POST } = await import('@/app/api/admin/settings/download-clients/route');
      await POST(req({ ...qbit }));
      expect(stored()[0].category).toBe('readmeabook');
      expect(fake.listed).toEqual([]);
    });

    it('a list failure answers 400 and saves nothing', async () => {
      fake.lists['http://qbit:8080'] = new Error('Failed to get qBittorrent categories: 403');
      const { POST } = await import('@/app/api/admin/settings/download-clients/route');
      const res = await POST(req({ ...qbit, category: 'audiobooks' }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Couldn't read qBittorrent's categories: Failed to get qBittorrent categories: 403");
      expect(store.setMany).not.toHaveBeenCalled();
    });
  });

  describe('PUT (edit)', () => {
    const saved = { id: 'c1', ...qbit, enabled: true, disableSSLVerify: false, remotePathMappingEnabled: false, category: 'Books' };
    const put = async (body: unknown) => {
      const { PUT } = await import('@/app/api/admin/settings/download-clients/[id]/route');
      return PUT(req(body), { params: Promise.resolve({ id: 'c1' }) });
    };

    it('an unchanged name lists nothing and keeps the saved values', async () => {
      store.values.download_clients = JSON.stringify([saved]);
      expect((await put({ name: 'Renamed', category: 'books' })).status).toBe(200);
      expect(fake.listed).toEqual([]);
      expect(stored()[0]).toMatchObject({ name: 'Renamed', category: 'Books' });
    });

    it('a URL and category changed together are decided against the new URL, not the cached service', async () => {
      store.values.download_clients = JSON.stringify([saved]);
      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      await getDownloadClientManager().getClientServiceForProtocol('torrent'); // caches a service for the old URL

      expect((await put({ url: 'http://qbit2:8080', password: 'p2', category: 'audiobooks' })).status).toBe(200);

      expect(fake.listed).toEqual(['http://qbit2:8080']);
      expect(stored()[0]).toMatchObject({ url: 'http://qbit2:8080', category: 'audiobooks' });
      expect(stored()[0]).not.toHaveProperty('ownedCategory'); // already there on the new instance
    });

    it('a list failure answers 400 and saves nothing', async () => {
      store.values.download_clients = JSON.stringify([saved]);
      fake.lists['http://qbit:8080'] = new Error('timeout');
      const res = await put({ category: 'new-one' });
      expect(res.status).toBe(400);
      expect(store.setMany).not.toHaveBeenCalled();
    });

    it('a sent ownedCategory is ignored', async () => {
      store.values.download_clients = JSON.stringify([saved]);
      await put({ name: 'x', ownedCategory: 'Books' });
      expect(stored()[0]).not.toHaveProperty('ownedCategory');
    });

    it('moving off ReadMeABook\'s own category forgets it; going back lists the client again', async () => {
      store.values.download_clients = JSON.stringify([{ ...saved, category: 'audiobooks', ownedCategory: 'audiobooks' }]);
      expect((await put({ category: 'readmeabook' })).status).toBe(200);
      expect(stored()[0]).toMatchObject({ category: 'readmeabook' });
      expect(stored()[0]).not.toHaveProperty('ownedCategory');

      fake.lists['http://qbit:8080'] = ['audiobooks']; // another app uses it now
      expect((await put({ category: 'audiobooks' })).status).toBe(200);
      expect(fake.listed).toEqual(['http://qbit:8080']);
      expect(stored()[0]).toMatchObject({ category: 'audiobooks' });
      expect(stored()[0]).not.toHaveProperty('ownedCategory');
    });

    it('a name with a slash answers 400 and saves nothing', async () => {
      store.values.download_clients = JSON.stringify([saved]);
      const res = await put({ category: 'audio/books' });
      expect(res.status).toBe(400);
      expect(store.setMany).not.toHaveBeenCalled();
    });
  });

  describe('POST and the legacy route never take ownership from the body', () => {
    it('POST ignores a sent ownedCategory', async () => {
      const { POST } = await import('@/app/api/admin/settings/download-clients/route');
      expect((await POST(req({ ...qbit, category: 'books', ownedCategory: 'Books' }))).status).toBe(200);
      expect(stored()[0].category).toBe('Books');
      expect(stored()[0]).not.toHaveProperty('ownedCategory');
    });

    it('the legacy route keeps the saved category and ownedCategory and ignores the body\'s', async () => {
      store.values.download_clients = JSON.stringify([{ id: 'c1', ...qbit, enabled: true, category: 'audiobooks', ownedCategory: 'audiobooks' }]);
      const { PUT } = await import('@/app/api/admin/settings/download-client/route');
      const res = await PUT(req({ ...qbit, category: 'Books', ownedCategory: 'Books' }));
      expect(res.status).toBe(200);
      expect(stored()[0]).toMatchObject({ id: 'c1', category: 'audiobooks', ownedCategory: 'audiobooks' });
      expect(fake.listed).toEqual([]);
    });
  });

  describe('services get the ownership flag', () => {
    it('owned for readmeabook and the ownedCategory (any case); not owned otherwise', async () => {
      const { getDownloadClientManager } = await import('@/lib/services/download-client-manager.service');
      const manager = getDownloadClientManager();
      const base = { enabled: true, disableSSLVerify: false, remotePathMappingEnabled: false };
      await manager.createClientFromConfig({ id: 'a', ...qbit, ...base, type: 'qbittorrent', category: 'readmeabook' });
      await manager.createClientFromConfig({ id: 'b', ...sab, ...base, type: 'sabnzbd', category: 'Books', ownedCategory: 'books' });
      await manager.createClientFromConfig({ id: 'c', ...sab, ...base, type: 'sabnzbd', category: 'books' });
      expect(fake.built.map((b) => b.owned)).toEqual([true, true, false]);
    });
  });
});
