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
});


