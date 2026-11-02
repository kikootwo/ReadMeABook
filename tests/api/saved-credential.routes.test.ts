/**
 * Component: Saved Credential Reuse Tests (connection test + settings save routes)
 * Documentation: documentation/settings-pages.md
 *
 * A masked secret means "use the saved one"; it may only be sent to the saved URL.
 */

import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const MASK = '••••••••';
// tests/setup.ts replaces fetch in beforeAll; keep the real one for the local ABS server
const realFetch = globalThis.fetch;
const config = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));
const plexMock = vi.hoisted(() => ({ testConnection: vi.fn(), getLibraries: vi.fn() }));
const prowlarrCtor = vi.hoisted(() => vi.fn());
const managerMock = vi.hoisted(() => ({ getAllClients: vi.fn(), testConnection: vi.fn(), createClientFromConfig: vi.fn() }));

vi.mock('@/lib/middleware/auth', () => ({
  requireSetupIncompleteOrAdmin: (req: unknown, handler: (r: unknown) => unknown) => handler(req),
  requireAuth: (req: unknown, handler: (r: unknown) => unknown) => handler(req),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ get: async (key: string) => config.values[key] ?? null }),
}));
vi.mock('@/lib/integrations/plex.service', () => ({ getPlexService: () => plexMock }));
vi.mock('@/lib/integrations/prowlarr.service', () => ({
  ProwlarrService: class { constructor(...args: unknown[]) { prowlarrCtor(...args); } getIndexers = vi.fn(async () => []); },
}));
vi.mock('@/lib/services/download-client-manager.service', () => ({ getDownloadClientManager: () => managerMock }));

const json = (body: unknown) => ({ json: async () => body }) as any;

describe('test-abs never sends the saved token to a different URL (real HTTP)', () => {
  let server: Server;
  let absUrl = '';
  const received: IncomingHttpHeaders[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      received.push(req.headers);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ libraries: [{ id: 'lib-1', name: 'Books', mediaType: 'book' }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    absUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  // Put back the unmocked-fetch guard from tests/setup.ts
  afterEach(() => {
    globalThis.fetch = guardedFetch;
  });
  let guardedFetch: typeof fetch;
  beforeEach(() => {
    guardedFetch = globalThis.fetch;
    globalThis.fetch = realFetch;
    received.length = 0;
    config.values = { 'audiobookshelf.api_token': 'saved-abs-token', 'audiobookshelf.server_url': 'http://abs.saved:13378' };
  });

  it('rejects a masked token for a URL other than the saved one, without contacting it', async () => {
    const { POST } = await import('@/app/api/setup/test-abs/route');
    const response = await POST(json({ serverUrl: absUrl, apiToken: MASK }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Audiobookshelf API token');
    expect(body.error).toContain('Settings');
    expect(received).toHaveLength(0);
  });

  it('rejects an empty token for a different URL too', async () => {
    const { POST } = await import('@/app/api/setup/test-abs/route');
    const response = await POST(json({ serverUrl: absUrl, apiToken: '' }));
    expect(response.status).toBe(400);
    expect(received).toHaveLength(0);
  });

  it('reuses the saved token for the saved URL (trailing slash ignored)', async () => {
    config.values['audiobookshelf.server_url'] = absUrl;
    const { POST } = await import('@/app/api/setup/test-abs/route');
    const response = await POST(json({ serverUrl: `${absUrl}/`, apiToken: MASK }));

    expect(response.status).toBe(200);
    expect(received[0].authorization).toBe('Bearer saved-abs-token');
  });

  it('sends a freshly entered token to any URL', async () => {
    const { POST } = await import('@/app/api/setup/test-abs/route');
    const response = await POST(json({ serverUrl: absUrl, apiToken: 'new-token' }));

    expect(response.status).toBe(200);
    expect(received[0].authorization).toBe('Bearer new-token');
  });
});

describe('sibling test routes apply the same rule', () => {
  beforeEach(() => {
    config.values = {
      plex_token: 'saved-plex', plex_url: 'http://plex.saved:32400',
      prowlarr_api_key: 'saved-prowlarr', prowlarr_url: 'http://prowlarr.saved:9696',
    };
    managerMock.getAllClients.mockResolvedValue([
      { id: 'c1', type: 'qbittorrent', url: 'http://qbit.saved:8080', username: 'u', password: 'saved-pass' },
    ]);
  });

  it('test-plex: masked token + different URL → 400, Plex not contacted', async () => {
    const { POST } = await import('@/app/api/admin/settings/test-plex/route');
    const response = await POST(json({ url: 'http://elsewhere:32400', token: MASK }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Plex token');
    expect(plexMock.testConnection).not.toHaveBeenCalled();
  });

  it('test-prowlarr: masked key + different URL → 400, no client built with the saved key', async () => {
    const { POST } = await import('@/app/api/admin/settings/test-prowlarr/route');
    const response = await POST(json({ url: 'http://elsewhere:9696', apiKey: MASK }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Prowlarr API key');
    expect(prowlarrCtor).not.toHaveBeenCalled();
  });

  it('test-prowlarr: masked key + saved URL → uses the saved key', async () => {
    const { POST } = await import('@/app/api/admin/settings/test-prowlarr/route');
    await POST(json({ url: 'http://prowlarr.saved:9696/', apiKey: MASK }));
    expect(prowlarrCtor).toHaveBeenCalledWith('http://prowlarr.saved:9696/', 'saved-prowlarr');
  });

  it.each([
    ['download-clients/test', '@/app/api/admin/settings/download-clients/test/route', { clientId: 'c1', type: 'qbittorrent', url: 'http://elsewhere:8080' }],
    ['download-clients/categories', '@/app/api/admin/settings/download-clients/categories/route', { clientId: 'c1', type: 'qbittorrent', url: 'http://elsewhere:8080' }],
    ['test-download-client (legacy)', '@/app/api/admin/settings/test-download-client/route', { type: 'qbittorrent', url: 'http://elsewhere:8080', password: MASK }],
  ])('%s: saved password + different URL → 400, client not contacted', async (_label, modulePath, body) => {
    const { POST } = await import(modulePath);
    const response = await POST(json(body));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('download client password or API key');
    expect(managerMock.testConnection).not.toHaveBeenCalled();
    expect(managerMock.createClientFromConfig).not.toHaveBeenCalled();
  });

  it('test-download-client (legacy): reuses the password of the same-type client saved at that URL', async () => {
    managerMock.getAllClients.mockResolvedValue([
      { id: 'c1', type: 'qbittorrent', url: 'http://qbit-a:8080', password: 'pass-a' },
      { id: 'c2', type: 'qbittorrent', url: 'http://qbit-b:8080', password: 'pass-b' },
    ]);
    managerMock.testConnection.mockResolvedValue({ success: true, message: 'ok' });
    const { POST } = await import('@/app/api/admin/settings/test-download-client/route');

    const response = await POST(json({ type: 'qbittorrent', url: 'http://qbit-b:8080', password: MASK }));

    expect(response.status).toBe(200);
    expect(managerMock.testConnection).toHaveBeenCalledWith(expect.objectContaining({ password: 'pass-b' }));
  });

  it('download-clients/test: a missing URL is reported before any saved-password check', async () => {
    const { POST } = await import('@/app/api/admin/settings/download-clients/test/route');
    const response = await POST(json({ clientId: 'c1', type: 'qbittorrent' }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('URL is required');
  });
});
