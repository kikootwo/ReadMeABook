/**
 * Component: BookDate Test Connection — access rules (real auth middleware)
 * Documentation: documentation/features/bookdate-prd.md
 *
 * Open to the setup wizard (built-in providers, caller-supplied key) while setup is
 * incomplete; admin only after setup. The saved key goes only to its saved provider and
 * URL. Error responses never include the remote response body.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  completed: true as boolean,
  setupLookupFails: false,
  savedConfig: null as null | { provider: string; apiKey: string; baseUrl: string | null },
}));
const fetchMock = vi.hoisted(() => vi.fn());
const logError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: {
    configuration: {
      findUnique: async () => {
        if (state.setupLookupFails) throw new Error('database starting up');
        return state.completed ? { key: 'setup_completed', value: 'true' } : null;
      },
    },
    user: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, deletedAt: null, sessionsInvalidatedAt: null }) },
    apiToken: {
      findUnique: async () => ({
        id: 't1', tokenPrefix: 'rmab_abc', expiresAt: null, role: 'admin',
        tokenUser: { id: 'u-admin', plexId: 'p1', plexUsername: 'admin', role: 'admin', deletedAt: null },
      }),
      update: async () => ({}),
    },
    bookDateConfig: { findFirst: async () => state.savedConfig },
  },
}));
vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ decrypt: (value: string) => `decrypted:${value}` }),
}));
vi.mock('@/lib/utils/jwt', () => ({
  verifyAccessToken: (token: string) =>
    token === 'admin-token' ? { sub: 'u-admin', role: 'admin', plexId: 'p1', username: 'admin' }
      : token === 'user-token' ? { sub: 'u-user', role: 'user', plexId: 'p2', username: 'user' }
      : null,
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: logError }) },
}));

function post(body: Record<string, unknown>, token?: string) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest('http://localhost/api/bookdate/test-connection', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

async function callRoute(body: Record<string, unknown>, token?: string) {
  const { POST } = await import('@/app/api/bookdate/test-connection/route');
  return POST(post(body, token));
}

const custom = { provider: 'custom', baseUrl: 'http://10.0.0.5:8080/v1' };
const modelsResponse = () => new Response(JSON.stringify({ data: [{ id: 'm1' }] }), { status: 200 });

describe('POST /api/bookdate/test-connection access', () => {
  beforeEach(() => {
    state.completed = true;
    state.setupLookupFails = false;
    state.savedConfig = null;
    fetchMock.mockReset();
    logError.mockReset();
    fetchMock.mockImplementation(async () => modelsResponse());
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an unauthenticated caller after setup without fetching anything', async () => {
    const response = await callRoute(custom);

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid bearer token after setup', async () => {
    const response = await callRoute(custom, 'garbage');

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an API token, even an admin one, after setup', async () => {
    const response = await callRoute(custom, 'rmab_abcdef0123456789');

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a signed-in non-admin after setup without fetching anything', async () => {
    const response = await callRoute(custom, 'user-token');

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when the setup state cannot be read', async () => {
    state.setupLookupFails = true;
    const response = await callRoute({ provider: 'openai', apiKey: 'sk-test' });

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets an admin test a custom provider after setup', async () => {
    const response = await callRoute(custom, 'admin-token');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, models: [{ id: 'm1', name: 'm1' }] });
    expect(fetchMock).toHaveBeenCalledWith('http://10.0.0.5:8080/v1/models', expect.anything());
  });

  it('lets the setup wizard test a built-in provider without signing in', async () => {
    state.completed = false;
    const response = await callRoute({ provider: 'openai', apiKey: 'sk-test' });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
  });

  it('refuses a custom provider during setup without fetching anything', async () => {
    state.completed = false;
    const response = await callRoute(custom);

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses the saved key during setup', async () => {
    state.completed = false;
    state.savedConfig = { provider: 'openai', apiKey: 'enc', baseUrl: null };
    const response = await callRoute({ provider: 'openai', useSavedKey: true });

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets an admin test with the saved key', async () => {
    state.savedConfig = { provider: 'openai', apiKey: 'enc', baseUrl: null };
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] }), { status: 200 }));
    const response = await callRoute({ provider: 'openai', useSavedKey: true }, 'admin-token');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models', {
      headers: { Authorization: 'Bearer decrypted:enc' },
    });
  });

  it('sends the saved key only to the saved URL, ignoring a baseUrl in the request', async () => {
    state.savedConfig = { provider: 'custom', apiKey: 'enc', baseUrl: 'http://llm.local:8080/v1' };
    const response = await callRoute(
      { provider: 'custom', useSavedKey: true, baseUrl: 'https://attacker.example/v1' },
      'admin-token',
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://llm.local:8080/v1/models');
  });

  it('refuses the saved key for a provider other than the saved one', async () => {
    state.savedConfig = { provider: 'openai', apiKey: 'enc', baseUrl: null };
    const response = await callRoute({ provider: 'claude', useSavedKey: true }, 'admin-token');

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/different provider/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns only well-formed model entries from a custom provider', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      data: [
        { id: 'good', name: 'Good model', extra: 'dropped' },
        { id: 'no-name' },
        { id: 'odd-name', name: { nested: true } },
        { id: 42, name: 'numeric id' },
        { name: 'missing id' },
        null,
        'bare-string',
      ],
    }), { status: 200 }));
    const response = await callRoute(custom, 'admin-token');

    expect((await response.json()).models).toEqual([
      { id: 'good', name: 'Good model' },
      { id: 'no-name', name: 'no-name' },
      { id: 'odd-name', name: 'odd-name' },
      { id: 'bare-string', name: 'bare-string' },
    ]);
  });

  it('says when a custom provider answers with something other than JSON, logging the body server-side', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>login page</html>', { status: 200 }));
    const response = await callRoute(custom, 'admin-token');
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/response was not JSON/i);
    expect(JSON.stringify(payload)).not.toContain('login page');
    expect(logError).toHaveBeenCalledWith(expect.any(String), { body: '<html>login page</html>' });
  });

  it('reports only the status, never the remote body, when the provider errors', async () => {
    fetchMock.mockImplementation(async () => new Response('internal-secret-page <html>admin panel</html>', { status: 404 }));
    const response = await callRoute(custom, 'admin-token');
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(400);
    expect(text).toContain('HTTP 404');
    expect(text).not.toContain('internal-secret-page');
    expect(logError).toHaveBeenCalledWith(expect.any(String), {
      status: 404,
      body: 'internal-secret-page <html>admin panel</html>',
    });
  });

  it('does not echo network error details', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:8080'));
    const response = await callRoute(custom, 'admin-token');
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(text).not.toContain('ECONNREFUSED');
  });
});
