/**
 * Component: Apprise Credentials through the Notification Routes
 * Documentation: documentation/backend/services/notifications.md
 *
 * Real NotificationService and EncryptionService; prisma, auth and the logger mocked.
 * Credentials never reach a response, a log line or a request URL, and a client cannot
 * get the server to decrypt ciphertext it supplies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.CONFIG_ENCRYPTION_KEY ??= 'test-config-encryption-key-32-bytes!';

const backends = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));
const logged = vi.hoisted(() => [] as unknown[][]);

vi.mock('@/lib/db', () => ({ prisma: { notificationBackend: backends } }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler({ user: { sub: 'admin', role: 'admin' } }),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/utils/logger', () => {
  const record = (...args: unknown[]) => { logged.push(args); };
  return { RMABLogger: { create: () => ({ info: record, debug: record, warn: record, error: record }) } };
});

import { getEncryptionService } from '@/lib/services/encryption.service';

const enc = getEncryptionService();
const MASK = '••••••••';
const SECRET = 'hunter2-p@ss';
const LEGACY_URL = `https://alice:${encodeURIComponent(SECRET)}@apprise.example/`;
const events = ['request_available'];
const json = (body: unknown) => ({ json: async () => body }) as any;
const leaks = (value: unknown) => JSON.stringify(value).includes('hunter2');

describe('Apprise credentials through the notification routes', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    Object.values(backends).forEach((fn) => fn.mockReset());
    logged.length = 0;
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    backends.create.mockImplementation(async ({ data }: any) => ({ id: 'n1', ...data }));
    backends.update.mockImplementation(async ({ data }: any) => ({ id: 'n1', type: 'apprise', name: 'Apprise', ...data }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('POST stores credentials typed into the URL in the fields, password encrypted', async () => {
    const { POST } = await import('@/app/api/admin/notifications/route');
    const response = await POST(json({
      type: 'apprise', name: 'Apprise', events,
      config: { serverUrl: LEGACY_URL, basicAuthUser: '', basicAuthPassword: '', urls: 'slack://t', configKey: '', tag: '', authToken: '' },
    }));
    const body = await response.json();
    const stored = backends.create.mock.calls[0][0].data.config;

    expect(response.status).toBe(201);
    expect(stored.serverUrl).toBe('https://apprise.example/');
    expect(stored.basicAuthUser).toBe('alice');
    expect(enc.decrypt(stored.basicAuthPassword)).toBe(SECRET);
    expect(leaks(stored)).toBe(false);
    expect(body.backend.config.basicAuthPassword).toBe(MASK);
    expect(leaks(body)).toBe(false);
  });

  it.each([
    ['POST', 'http//alice:hunter2-p@ss@apprise:8000'],
    ['POST', 'alice:hunter2-p@ss@apprise:8000'],
  ])('%s refuses an unparseable URL with @ without echoing it anywhere', async (_method, serverUrl) => {
    const { POST } = await import('@/app/api/admin/notifications/route');
    const response = await POST(json({ type: 'apprise', name: 'Apprise', events, config: { serverUrl, urls: 'slack://t' } }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(backends.create).not.toHaveBeenCalled();
    expect(leaks(body)).toBe(false);
    expect(leaks(logged)).toBe(false);
  });

  it('POST refuses a non-text secret value and stores nothing', async () => {
    const { POST } = await import('@/app/api/admin/notifications/route');
    const response = await POST(json({ type: 'apprise', name: 'Apprise', events, config: { serverUrl: 'http://apprise:8000', authToken: 424242 } }));

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe('Auth Token must be text.');
    expect(backends.create).not.toHaveBeenCalled();
    expect(JSON.stringify(logged)).not.toContain('424242');
  });

  it('the test route refuses an unparseable URL with @ without echoing it', async () => {
    const { POST } = await import('@/app/api/admin/notifications/test/route');
    const response = await POST(json({ type: 'apprise', config: { serverUrl: 'http//alice:hunter2-p@ss@apprise', urls: 'x://y' } }));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(leaks(await response.json())).toBe(false);
    expect(leaks(logged)).toBe(false);
  });

  it('the test route sends Basic auth from URL credentials and a URL without them', async () => {
    const { POST } = await import('@/app/api/admin/notifications/test/route');
    const response = await POST(json({ type: 'apprise', config: { serverUrl: LEGACY_URL, urls: 'x://y' } }));

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://apprise.example/notify/');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Basic ${Buffer.from(`alice:${SECRET}`).toString('base64')}`,
    });
    expect(leaks(logged)).toBe(false);
  });

  it('the test route never decrypts ciphertext a client supplies', async () => {
    const otherSecret = enc.encrypt('prowlarr-api-key');
    const { POST } = await import('@/app/api/admin/notifications/test/route');
    await POST(json({ type: 'apprise', config: { serverUrl: 'https://evil.example', authToken: otherSecret, urls: 'x://y' } }));

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${otherSecret}`);
    expect(headers.Authorization).not.toContain('prowlarr-api-key');
  });

  it('GET shows a legacy row in its migrated form, with no credentials anywhere', async () => {
    backends.findMany.mockResolvedValue([
      { id: 'n1', type: 'apprise', name: 'Apprise', events, enabled: true, config: { serverUrl: LEGACY_URL, urls: enc.encrypt('slack://t') } },
    ]);
    const { GET } = await import('@/app/api/admin/notifications/route');
    const body = await (await GET(json({}))).json();

    expect(body.backends[0].config).toEqual({
      serverUrl: 'https://apprise.example/', basicAuthUser: 'alice', basicAuthPassword: MASK, urls: MASK,
    });
    expect(leaks(body)).toBe(false);
  });

  it('PUT of a legacy row saved unchanged from GET keeps every secret and strips the URL', async () => {
    const existing = { id: 'n1', type: 'apprise', name: 'Apprise', events, enabled: true, config: { serverUrl: LEGACY_URL, urls: enc.encrypt('slack://t') } };
    backends.findUnique.mockResolvedValue(existing);
    const shown = { serverUrl: 'https://apprise.example/', basicAuthUser: 'alice', basicAuthPassword: MASK, urls: MASK, configKey: '', tag: '', authToken: '' };

    const { PUT } = await import('@/app/api/admin/notifications/[id]/route');
    const response = await PUT(json({ config: shown }), { params: Promise.resolve({ id: 'n1' }) });
    const stored = backends.update.mock.calls[0][0].data.config;

    expect(response.status).toBe(200);
    expect(stored.serverUrl).toBe('https://apprise.example/');
    expect(enc.decrypt(stored.basicAuthPassword)).toBe(SECRET);
    expect(enc.decrypt(stored.urls)).toBe('slack://t');
    expect(JSON.stringify(stored)).not.toContain(MASK);
    expect(leaks(stored)).toBe(false);
    expect(leaks(await response.json())).toBe(false);
  });

  it('PUT with a changed server and the masked password is refused', async () => {
    backends.findUnique.mockResolvedValue({ id: 'n1', type: 'apprise', name: 'Apprise', events, enabled: true, config: { serverUrl: LEGACY_URL } });
    const { PUT } = await import('@/app/api/admin/notifications/[id]/route');
    const response = await PUT(
      json({ config: { serverUrl: 'https://elsewhere.example', basicAuthUser: 'alice', basicAuthPassword: MASK } }),
      { params: Promise.resolve({ id: 'n1' }) },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('Basic Auth Password');
    expect(backends.update).not.toHaveBeenCalled();
  });
});
