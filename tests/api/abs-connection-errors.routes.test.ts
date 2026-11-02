/**
 * Component: Audiobookshelf Connection Error Route Tests
 * Documentation: documentation/setup-wizard.md
 *
 * The setup test and the libraries route must say why a connection failed
 * (refused, DNS, timeout, TLS) and name the host, never the API key.
 */

import http from 'http';
import type { AddressInfo } from 'net';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API_KEY = 'abs-api-key-0123456789abcdef';

// tests/setup.ts swaps fetch for a thrower in beforeAll; module code runs first, so this is Node's real fetch.
const realFetch = globalThis.fetch;

// Plain holders: vitest's mockReset wipes implementations set inside vi.mock factories.
const config: Record<string, string | null> = {};
const logged: Array<{ level: string; message: string; metadata?: unknown }> = [];

vi.mock('@/lib/db', () => ({
  prisma: { configuration: { findUnique: async () => null } }, // setup not complete: route open
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ get: async (key: string) => config[key] ?? null }),
}));

vi.mock('@/lib/middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/middleware/auth')>();
  return {
    ...actual,
    requireAuth: (req: unknown, handler: (r: unknown) => unknown) => handler({ ...(req as object), user: { id: 'admin-1', role: 'admin' } }),
    requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
  };
});

vi.mock('@/lib/utils/logger', () => {
  const make = () => ({
    debug: () => {},
    info: () => {},
    warn: (message: string, metadata?: unknown) => logged.push({ level: 'warn', message, metadata }),
    error: (message: string, metadata?: unknown) => logged.push({ level: 'error', message, metadata }),
  });
  return { RMABLogger: { create: make, forJob: make } };
});

const servers: http.Server[] = [];

async function listen(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function fetchFailed(cause: Error, props: Record<string, unknown>): TypeError {
  return new TypeError('fetch failed', { cause: Object.assign(cause, props) });
}

async function testAbs(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/setup/test-abs/route');
  const response = await POST({ json: async () => body, headers: new Headers() } as unknown as NextRequest);
  const text = await response.text();
  return { status: response.status, text, payload: JSON.parse(text) };
}

async function absLibraries() {
  const { GET } = await import('@/app/api/admin/settings/audiobookshelf/libraries/route');
  const response = await GET({ headers: new Headers() } as unknown as NextRequest);
  const text = await response.text();
  return { status: response.status, text, payload: JSON.parse(text) };
}

function loggedText(): string {
  return JSON.stringify(logged);
}

const LIBRARIES = {
  libraries: [
    { id: 'lib-1', name: 'Audiobooks', mediaType: 'book', stats: { totalItems: 12 } },
    { id: 'lib-2', name: 'Podcasts', mediaType: 'podcast' },
  ],
};

beforeEach(() => {
  logged.length = 0;
  for (const key of Object.keys(config)) delete config[key];
  vi.stubGlobal('fetch', realFetch);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

describe('POST /api/setup/test-abs failure reasons', () => {
  it('reports a refused connection with host and port, and logs the cause without the key', async () => {
    const port = await closedPort();

    const { status, text, payload } = await testAbs({ serverUrl: `http://127.0.0.1:${port}`, apiToken: API_KEY });

    expect(status).toBe(500);
    expect(payload.error).toBe(
      `Could not reach Audiobookshelf at 127.0.0.1:${port}: connection refused, nothing is accepting connections at that address and port (ECONNREFUSED)`
    );
    expect(text).not.toContain(API_KEY);
    expect(logged).toHaveLength(1);
    expect(logged[0].level).toBe('error');
    expect(loggedText()).toContain('ECONNREFUSED');
    expect(loggedText()).not.toContain(API_KEY);
  });

  it('reports a DNS failure', async () => {
    vi.stubGlobal('fetch', async () => {
      throw fetchFailed(new Error('getaddrinfo ENOTFOUND abs.invalid'), { code: 'ENOTFOUND', hostname: 'abs.invalid' });
    });

    const { text, payload } = await testAbs({ serverUrl: 'http://abs.invalid:13378', apiToken: API_KEY });

    expect(payload.error).toBe(
      'Could not reach Audiobookshelf at abs.invalid:13378: the host name could not be resolved, the DNS lookup failed (ENOTFOUND)'
    );
    expect(text).not.toContain(API_KEY);
    expect(loggedText()).toContain('getaddrinfo ENOTFOUND abs.invalid');
    expect(loggedText()).not.toContain(API_KEY);
  });

  it('reports a connect timeout', async () => {
    vi.stubGlobal('fetch', async () => {
      throw fetchFailed(new Error('Connect Timeout Error (attempted address: 10.255.255.1:13378, timeout: 10000ms)'), {
        name: 'ConnectTimeoutError',
        code: 'UND_ERR_CONNECT_TIMEOUT',
      });
    });

    const { text, payload } = await testAbs({ serverUrl: 'http://10.255.255.1:13378/', apiToken: API_KEY });

    expect(payload.error).toBe(
      'Could not reach Audiobookshelf at 10.255.255.1:13378: the connection timed out (UND_ERR_CONNECT_TIMEOUT)'
    );
    expect(text).not.toContain(API_KEY);
    expect(loggedText()).not.toContain(API_KEY);
  });

  it('reports a TLS failure when https points at a plain http port', async () => {
    const port = await listen((_req, res) => res.end('plain http'));

    const { text, payload } = await testAbs({ serverUrl: `https://127.0.0.1:${port}`, apiToken: API_KEY });

    expect(payload.error).toMatch(new RegExp(`^Could not reach Audiobookshelf at 127\\.0\\.0\\.1:${port}: the TLS handshake failed`));
    expect(text).not.toContain(API_KEY);
    expect(loggedText()).not.toContain(API_KEY);
  });

  it('reports a rejected certificate', async () => {
    vi.stubGlobal('fetch', async () => {
      throw fetchFailed(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' });
    });

    const { payload } = await testAbs({ serverUrl: 'https://abs.lan', apiToken: API_KEY });

    expect(payload.error).toBe(
      'Could not reach Audiobookshelf at abs.lan:443: the TLS certificate was rejected: certificate has expired (CERT_HAS_EXPIRED)'
    );
  });

  // A line break inside the value (a wrapped copy) makes Headers throw with the value in its message.
  // Headers trims leading and trailing whitespace before quoting it, so the quoted text can differ
  // from the token as supplied.
  it.each([
    ['inner line break', `${API_KEY}\nwrapped`],
    ['trailing line break', `${API_KEY}\nwrapped\n`],
    ['trailing spaces', `${API_KEY}\nwrapped  `],
    ['trailing tab', `${API_KEY}\nwrapped\t`],
  ])('never returns or logs a pasted key that breaks the Authorization header (%s)', async (_label, pasted) => {
    const port = await closedPort();

    const { text } = await testAbs({ serverUrl: `http://127.0.0.1:${port}`, apiToken: pasted });

    expect(text).not.toContain(API_KEY);
    expect(JSON.parse(text).error).toContain('API token');
    expect(loggedText()).not.toContain(API_KEY);
  });

  it('never returns or logs a saved key reused for a masked token', async () => {
    const port = await closedPort();
    config['audiobookshelf.server_url'] = `http://127.0.0.1:${port}`;
    config['audiobookshelf.api_token'] = `${API_KEY}\nwrapped`;

    const { text } = await testAbs({ serverUrl: `http://127.0.0.1:${port}`, apiToken: '••••••••' });

    expect(JSON.parse(text).error).toContain('API token'); // the saved key was used
    expect(text).not.toContain(API_KEY);
    expect(loggedText()).not.toContain(API_KEY);
  });

  it('hints when the server URL ends in /api', async () => {
    const port = await listen((_req, res) => {
      res.statusCode = 404;
      res.end('Not Found');
    });

    const { status, payload } = await testAbs({ serverUrl: `http://127.0.0.1:${port}/api/`, apiToken: API_KEY });

    expect(status).toBe(400);
    expect(payload.error).toBe(
      `Connection failed: 404 Not Found. The server URL ends in /api. Remove it and use http://127.0.0.1:${port}`
    );
  });

  it('reports a page that is not Audiobookshelf JSON', async () => {
    const port = await listen((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html>login</html>');
    });

    const { status, payload } = await testAbs({ serverUrl: `http://127.0.0.1:${port}`, apiToken: API_KEY });

    expect(status).toBe(400);
    expect(payload.error).toMatch(/^Invalid response from Audiobookshelf server/);
  });

  it('still returns the book libraries from a working server', async () => {
    let seenAuth: string | undefined;
    let seenPath: string | undefined;
    const port = await listen((req, res) => {
      seenAuth = req.headers.authorization;
      seenPath = req.url;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(LIBRARIES));
    });

    const { status, payload } = await testAbs({ serverUrl: `http://127.0.0.1:${port}/`, apiToken: API_KEY });

    expect(status).toBe(200);
    expect(payload).toEqual({
      success: true,
      serverInfo: { name: 'Audiobookshelf', version: 'Connected' },
      libraries: [{ id: 'lib-1', name: 'Audiobooks', itemCount: 12 }],
    });
    expect(seenAuth).toBe(`Bearer ${API_KEY}`);
    expect(seenPath).toBe('/api/libraries');
    expect(logged).toHaveLength(0);
  });
});

describe('GET /api/admin/settings/audiobookshelf/libraries failure reasons', () => {
  it('reports a refused connection with host and port, without the key', async () => {
    const port = await closedPort();
    config['audiobookshelf.server_url'] = `http://127.0.0.1:${port}`;
    config['audiobookshelf.api_token'] = API_KEY;

    const { status, text, payload } = await absLibraries();

    expect(status).toBe(500);
    expect(payload.error).toBe(
      `Could not reach Audiobookshelf at 127.0.0.1:${port}: connection refused, nothing is accepting connections at that address and port (ECONNREFUSED)`
    );
    expect(text).not.toContain(API_KEY);
    expect(loggedText()).toContain('ECONNREFUSED');
    expect(loggedText()).not.toContain(API_KEY);
  });

  it('still returns the book libraries from a working server', async () => {
    const port = await listen((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(LIBRARIES));
    });
    config['audiobookshelf.server_url'] = `http://127.0.0.1:${port}`;
    config['audiobookshelf.api_token'] = API_KEY;

    const { status, payload } = await absLibraries();

    expect(status).toBe(200);
    expect(payload).toEqual({
      libraries: [{ id: 'lib-1', name: 'Audiobooks', type: 'book', itemCount: 12 }],
    });
  });
});
