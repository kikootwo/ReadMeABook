/**
 * Component: Admin Prowlarr Indexers API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

let authRequest: any;

const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const prowlarrMock = vi.hoisted(() => ({
  getIndexers: vi.fn(),
}));
const configServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
  setMany: vi.fn(),
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/integrations/prowlarr.service', () => ({
  getProwlarrService: async () => prowlarrMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

describe('Admin Prowlarr indexers route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' }, json: vi.fn() };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  it('returns indexers with saved config', async () => {
    prowlarrMock.getIndexers.mockResolvedValueOnce([{ id: 1, name: 'Indexer', protocol: 'torrent' }]);
    configServiceMock.get.mockResolvedValueOnce(JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 5, seedingTimeMinutes: 10 }]));
    configServiceMock.get.mockResolvedValueOnce('[]');

    const { GET } = await import('@/app/api/admin/settings/prowlarr/indexers/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(payload.indexers[0].enabled).toBe(true);
  });

  it('returns every saved per-indexer field, including ratioLimit', async () => {
    prowlarrMock.getIndexers.mockResolvedValueOnce([
      { id: 1, name: 'Torrent', protocol: 'torrent', privacy: 'private' },
      { id: 2, name: 'Usenet', protocol: 'usenet', privacy: 'public' },
      { id: 3, name: 'Not added', protocol: 'torrent', privacy: 'public' },
    ]);
    configServiceMock.get.mockResolvedValueOnce(JSON.stringify([
      { id: 1, name: 'Torrent', protocol: 'torrent', priority: 4, rssEnabled: true, audiobookCategories: [3030], ebookCategories: [7020], seedingTimeMinutes: 30, ratioLimit: 1.5 },
      { id: 2, name: 'Usenet', protocol: 'usenet', priority: 6, rssEnabled: false, audiobookCategories: [3030], ebookCategories: [7020], removeAfterProcessing: false },
    ]));
    configServiceMock.get.mockResolvedValueOnce('[]');

    const { GET } = await import('@/app/api/admin/settings/prowlarr/indexers/route');
    const payload = await (await GET({} as any)).json();

    expect(payload.indexers[0]).toMatchObject({ id: 1, enabled: true, priority: 4, rssEnabled: true, seedingTimeMinutes: 30, ratioLimit: 1.5 });
    expect(payload.indexers[1]).toMatchObject({ id: 2, enabled: true, priority: 6, removeAfterProcessing: false });
    expect(payload.indexers[2]).toMatchObject({ id: 3, enabled: false, priority: 10, seedingTimeMinutes: 0, ratioLimit: 0 });
  });

  it('saves indexer configuration', async () => {
    authRequest.json.mockResolvedValue({
      indexers: [{ id: 1, name: 'Indexer', protocol: 'torrent', enabled: true, priority: 10, seedingTimeMinutes: 0, ratioLimit: 1.5 }],
      flagConfigs: [],
    });

    const { PUT } = await import('@/app/api/admin/settings/prowlarr/indexers/route');
    const response = await PUT({} as any);
    const payload = await response.json();

    expect(payload.success).toBe(true);
    expect(configServiceMock.setMany).toHaveBeenCalled();
    const setManyArg = configServiceMock.setMany.mock.calls[0][0];
    const indexersEntry = setManyArg.find((e: any) => e.key === 'prowlarr_indexers');
    expect(indexersEntry).toBeDefined();
    const persisted = JSON.parse(indexersEntry.value);
    expect(persisted[0]).toMatchObject({ id: 1, ratioLimit: 1.5, seedingTimeMinutes: 0 });
  });

  describe('PUT guards', () => {
    const put = async (body: unknown) => {
      authRequest.json.mockResolvedValue(body);
      const { PUT } = await import('@/app/api/admin/settings/prowlarr/indexers/route');
      const response = await PUT({} as any);
      return { status: response.status, payload: await response.json() };
    };
    const torrent = { id: 1, name: 'Tracker', protocol: 'torrent', enabled: true, priority: 10 };

    it('refuses an empty list that would remove saved indexers', async () => {
      configServiceMock.get.mockResolvedValueOnce(JSON.stringify([{ id: 1, name: 'Tracker' }, { id: 2, name: 'Other' }]));

      const { status, payload } = await put({ indexers: [], flagConfigs: [] });

      expect(status).toBe(409);
      expect(payload.error).toMatch(/Refusing to remove all 2 saved indexer/);
      expect(configServiceMock.setMany).not.toHaveBeenCalled();
    });

    it('saves an empty list when explicitly allowed', async () => {
      const { status } = await put({ indexers: [], flagConfigs: [], allowEmpty: true });

      expect(status).toBe(200);
      const entry = configServiceMock.setMany.mock.calls[0][0].find((e: any) => e.key === 'prowlarr_indexers');
      expect(entry.value).toBe('[]');
    });

    it('leaves the saved flag rules alone when flagConfigs is not sent', async () => {
      const { status } = await put({ indexers: [], allowEmpty: true });

      expect(status).toBe(200);
      const keys = configServiceMock.setMany.mock.calls[0][0].map((e: any) => e.key);
      expect(keys).toEqual(['prowlarr_indexers']);
    });

    it('saves an empty list when nothing was saved before', async () => {
      configServiceMock.get.mockResolvedValueOnce(null);

      const { status } = await put({ indexers: [] });

      expect(status).toBe(200);
      expect(configServiceMock.setMany).toHaveBeenCalled();
    });

    it.each([
      ['a negative ratio limit', { ratioLimit: -0.5 }],
      ['a negative seeding time', { seedingTimeMinutes: -1 }],
      ['a string ratio limit', { ratioLimit: '1.5' }],
      ['a NaN seeding time', { seedingTimeMinutes: Number.NaN }],
      ['an infinite ratio limit', { ratioLimit: Number.POSITIVE_INFINITY }],
    ])('rejects %s', async (_label, limits) => {
      const { status, payload } = await put({ indexers: [{ ...torrent, ...limits }] });

      expect(status).toBe(400);
      expect(payload.error).toMatch(/^Tracker: (ratioLimit|seedingTimeMinutes) must be a number of 0 or more$/);
      expect(configServiceMock.setMany).not.toHaveBeenCalled();
    });

    it('accepts 0 and decimals, and missing limits', async () => {
      const { status } = await put({
        indexers: [
          { ...torrent, seedingTimeMinutes: 0, ratioLimit: 1.25 },
          { id: 2, name: 'NZB', protocol: 'usenet', enabled: true, priority: 5 },
        ],
      });

      expect(status).toBe(200);
    });

    it('does not check limits on usenet indexers (they are discarded)', async () => {
      const { status } = await put({
        indexers: [{ id: 2, name: 'NZB', protocol: 'usenet', enabled: true, priority: 5, ratioLimit: -1, seedingTimeMinutes: 'x' }],
      });

      expect(status).toBe(200);
      const entry = configServiceMock.setMany.mock.calls[0][0].find((e: any) => e.key === 'prowlarr_indexers');
      expect(JSON.parse(entry.value)[0].ratioLimit).toBeUndefined();
    });

    it('returns 400 for a body that is not JSON', async () => {
      authRequest.json.mockRejectedValue(new SyntaxError('Unexpected token'));
      const { PUT } = await import('@/app/api/admin/settings/prowlarr/indexers/route');

      const response = await PUT({} as any);

      expect(response.status).toBe(400);
      expect(configServiceMock.setMany).not.toHaveBeenCalled();
    });

    it('rejects a body without an indexers array', async () => {
      const { status } = await put({ flagConfigs: [] });

      expect(status).toBe(400);
      expect(configServiceMock.setMany).not.toHaveBeenCalled();
    });
  });
});
