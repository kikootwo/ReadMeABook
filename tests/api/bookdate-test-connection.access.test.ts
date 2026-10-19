/**
 * Component: BookDate Test Connection — access rules (real auth middleware)
 * Documentation: documentation/features/bookdate-prd.md
 *
 * Open to the setup wizard while setup is incomplete; admin only after setup.
 * Error responses never include the remote response body.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setup = vi.hoisted(() => ({ completed: true }));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: {
    configuration: {
      findUnique: async () => (setup.completed ? { key: 'setup_completed', value: 'true' } : null),
    },
    user: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, deletedAt: null, sessionsInvalidatedAt: null }) },
    bookDateConfig: { findFirst: async () => null },
  },
}));
vi.mock('@/lib/utils/jwt', () => ({
  verifyAccessToken: (token: string) =>
    token === 'admin-token' ? { sub: 'u-admin', role: 'admin', plexId: 'p1', username: 'admin' }
      : token === 'user-token' ? { sub: 'u-user', role: 'user', plexId: 'p2', username: 'user' }
      : null,
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

function post(body: Record<string, unknown>, token?: string) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('http://localhost/api/bookdate/test-connection', {
    method: 'POST', headers, body: JSON.stringify(body),
  }) as any;
}

const custom = { provider: 'custom', baseUrl: 'http://10.0.0.5:8080/v1' };

describe('POST /api/bookdate/test-connection access', () => {
  beforeEach(() => {
    setup.completed = true;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an unauthenticated caller after setup without fetching anything', async () => {
    const { POST } = await import('@/app/api/bookdate/test-connection/route');
    const response = await POST(post(custom));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a signed-in non-admin after setup without fetching anything', async () => {
    const { POST } = await import('@/app/api/bookdate/test-connection/route');
    const response = await POST(post(custom, 'user-token'));

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets an admin test after setup', async () => {
    const { POST } = await import('@/app/api/bookdate/test-connection/route');
    const response = await POST(post(custom, 'admin-token'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, models: [{ id: 'm1', name: 'm1' }] });
    expect(fetchMock).toHaveBeenCalledWith('http://10.0.0.5:8080/v1/models', expect.anything());
  });

  it('lets the setup wizard test without signing in while setup is incomplete', async () => {
    setup.completed = false;
    const { POST } = await import('@/app/api/bookdate/test-connection/route');
    const response = await POST(post(custom));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses the saved key during setup', async () => {
    setup.completed = false;
    const { POST } = await import('@/app/api/bookdate/test-connection/route');
    const response = await POST(post({ provider: 'custom', useSavedKey: true }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports only the status, never the remote body, when the provider errors', async () => {
    fetchMock.mockResolvedValue(new Response('internal-secret-page <html>admin panel</html>', { status: 404 }));
    const { POST } = await import('@/app/api/bookdate/test-connection/route');
    const response = await POST(post(custom, 'admin-token'));
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(400);
    expect(text).toContain('HTTP 404');
    expect(text).not.toContain('internal-secret-page');
  });

  it('does not echo network error details', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:8080'));
    const { POST } = await import('@/app/api/bookdate/test-connection/route');
    const response = await POST(post(custom, 'admin-token'));
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(text).not.toContain('ECONNREFUSED');
  });
});
