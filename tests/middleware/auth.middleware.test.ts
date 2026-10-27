/**
 * Component: Auth Middleware Tests
 * Documentation: documentation/backend/services/auth.md
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';
import crypto from 'crypto';

const prismaMock = createPrismaMock();
const verifyAccessTokenMock = vi.fn();

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/utils/jwt', () => ({
  verifyAccessToken: verifyAccessTokenMock,
}));

const makeRequest = (authHeader?: string, pathname = '/api/requests', method = 'GET') => ({
  method,
  nextUrl: { pathname },
  headers: {
    get: (key: string) => {
      if (key.toLowerCase() === 'authorization') {
        return authHeader ?? null;
      }
      return null;
    },
  },
});

// Helper to create a valid API token hash for testing
const createTestApiToken = (token: string) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

describe('auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects requests without a token', async () => {
    const { requireAuth } = await import('@/lib/middleware/auth');

    const response = await requireAuth(makeRequest() as any, vi.fn());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Unauthorized');
  });

  it('rejects invalid tokens', async () => {
    verifyAccessTokenMock.mockReturnValue(null);
    const { requireAuth } = await import('@/lib/middleware/auth');

    const response = await requireAuth(makeRequest('Bearer badtoken') as any, vi.fn());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.message).toMatch(/invalid/i);
  });

  it('rejects tokens for missing users', async () => {
    verifyAccessTokenMock.mockReturnValue({
      sub: 'user-1',
      plexId: 'plex-1',
      username: 'user',
      role: 'user',
      iat: 1,
      exp: 2,
    });
    prismaMock.user.findUnique.mockResolvedValue(null);
    const { requireAuth } = await import('@/lib/middleware/auth');

    const response = await requireAuth(makeRequest('Bearer token') as any, vi.fn());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.message).toMatch(/user not found/i);
  });

  it('passes authenticated requests to handler', async () => {
    verifyAccessTokenMock.mockReturnValue({
      sub: 'user-1',
      plexId: 'plex-1',
      username: 'user',
      role: 'user',
      iat: 1,
      exp: 2,
    });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' });
    const { requireAuth } = await import('@/lib/middleware/auth');

    const handler = vi.fn(async (req: any) =>
      NextResponse.json({ ok: true, userId: req.user?.id })
    );
    const response = await requireAuth(makeRequest('Bearer token') as any, handler);
    const payload = await response.json();

    expect(handler).toHaveBeenCalled();
    expect(payload.userId).toBe('user-1');
  });

  it('requires admin role', async () => {
    const { requireAdmin } = await import('@/lib/middleware/auth');

    const noUserResponse = await requireAdmin({} as any, vi.fn());
    expect(noUserResponse.status).toBe(401);

    const response = await requireAdmin({ user: { role: 'user' } } as any, vi.fn());
    expect(response.status).toBe(403);
  });

  it('allows admin users', async () => {
    const { requireAdmin } = await import('@/lib/middleware/auth');

    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const response = await requireAdmin({ user: { role: 'admin' } } as any, handler);

    expect(handler).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('requires local admin with setup flag', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isSetupAdmin: true,
      plexId: 'local-admin',
    });
    const { requireLocalAdmin } = await import('@/lib/middleware/auth');

    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const response = await requireLocalAdmin(
      { user: { id: 'user-1', role: 'admin' } } as any,
      handler
    );

    expect(handler).toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('rejects non-local admins', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isSetupAdmin: false,
      plexId: 'plex-user',
    });
    const { requireLocalAdmin } = await import('@/lib/middleware/auth');

    const response = await requireLocalAdmin(
      { user: { id: 'user-1', role: 'admin' } } as any,
      vi.fn()
    );

    expect(response.status).toBe(403);
  });

  it('checks local admin helper', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      isSetupAdmin: true,
      plexId: 'local-admin',
    });
    const { isLocalAdmin } = await import('@/lib/middleware/auth');

    const result = await isLocalAdmin('user-1');
    expect(result).toBe(true);
  });

  it('rejects JWT tokens for soft-deleted users', async () => {
    verifyAccessTokenMock.mockReturnValue({
      sub: 'user-1',
      plexId: 'plex-1',
      username: 'user',
      role: 'user',
      iat: 1,
      exp: 2,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      deletedAt: new Date(),
    });
    const { requireAuth } = await import('@/lib/middleware/auth');

    const response = await requireAuth(makeRequest('Bearer token') as any, vi.fn());
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.message).toMatch(/user not found/i);
  });

  it('rejects JWT tokens issued before the account sessions were revoked', async () => {
    verifyAccessTokenMock.mockReturnValue({
      sub: 'user-1', plexId: 'plex-1', username: 'user', role: 'user', iat: 1000, exp: 5000,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1', deletedAt: null, registrationStatus: 'approved',
      sessionsInvalidatedAt: new Date(2000 * 1000),
    });
    const { requireAuth } = await import('@/lib/middleware/auth');

    const handler = vi.fn();
    const response = await requireAuth(makeRequest('Bearer token') as any, handler);

    expect(response.status).toBe(401);
    expect((await response.json()).message).toBe('Session has been revoked');
    expect(handler).not.toHaveBeenCalled();
  });

  it('accepts JWT tokens issued in the same second as, or after, the revocation', async () => {
    verifyAccessTokenMock.mockReturnValue({
      sub: 'user-1', plexId: 'plex-1', username: 'user', role: 'user', iat: 2000, exp: 5000,
    });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1', deletedAt: null, registrationStatus: 'approved',
      sessionsInvalidatedAt: new Date(2000 * 1000 + 500),
    });
    const { requireAuth } = await import('@/lib/middleware/auth');

    const handler = vi.fn(async () => NextResponse.json({ ok: true }));
    const response = await requireAuth(makeRequest('Bearer token') as any, handler);

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  describe('API token authentication', () => {
    const testToken = 'rmab_test1234567890abcdef';
    const testTokenHash = createTestApiToken(testToken);

    it('rejects API tokens for soft-deleted users', async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue({
        id: 'token-1',
        tokenHash: testTokenHash,
        role: 'user',
        expiresAt: null,
        tokenUser: {
          id: 'user-1',
          plexUsername: 'deleteduser',
          role: 'user',
          deletedAt: new Date(),
        },
      });
      const { requireAuth } = await import('@/lib/middleware/auth');

      const response = await requireAuth(makeRequest(`Bearer ${testToken}`) as any, vi.fn());
      const payload = await response.json();

      expect(response.status).toBe(401);
      expect(payload.message).toMatch(/invalid.*expired/i);
    });

    it('rejects API tokens for missing users', async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue({
        id: 'token-1',
        tokenHash: testTokenHash,
        role: 'user',
        expiresAt: null,
        tokenUser: null,
      });
      const { requireAuth } = await import('@/lib/middleware/auth');

      const response = await requireAuth(makeRequest(`Bearer ${testToken}`) as any, vi.fn());
      const payload = await response.json();

      expect(response.status).toBe(401);
      expect(payload.message).toMatch(/invalid.*expired/i);
    });

    it('accepts valid API tokens for active users on allowed endpoints', async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue({
        id: 'token-1',
        tokenHash: testTokenHash,
        role: 'user',
        expiresAt: null,
        tokenUser: {
          id: 'user-1',
          plexUsername: 'activeuser',
          role: 'user',
          deletedAt: null,
        },
      });
      prismaMock.apiToken.update.mockResolvedValue({});
      const { requireAuth } = await import('@/lib/middleware/auth');

      const handler = vi.fn(async (req: any) =>
        NextResponse.json({ ok: true, userId: req.user?.id })
      );
      const response = await requireAuth(
        makeRequest(`Bearer ${testToken}`, '/api/requests', 'GET') as any,
        handler
      );
      const payload = await response.json();

      expect(handler).toHaveBeenCalled();
      expect(payload.userId).toBe('user-1');
    });

    it('blocks API tokens on endpoints not in the allowlist', async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue({
        id: 'token-1',
        tokenHash: testTokenHash,
        role: 'admin',
        expiresAt: null,
        tokenUser: {
          id: 'user-1',
          plexUsername: 'activeuser',
          role: 'admin',
          deletedAt: null,
        },
      });
      prismaMock.apiToken.update.mockResolvedValue({});
      const { requireAuth } = await import('@/lib/middleware/auth');

      const handler = vi.fn();
      const response = await requireAuth(
        makeRequest(`Bearer ${testToken}`, '/api/admin/settings', 'GET') as any,
        handler
      );
      const payload = await response.json();

      expect(handler).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      expect(payload.message).toMatch(/not available via API token/i);
    });

    it('allows API tokens on every permitted endpoint (incl. dynamic ID match)', async () => {
      const allowedCalls: Array<[string, string]> = [
        ['GET', '/api/auth/me'],
        ['GET', '/api/audiobooks/search'],
        ['GET', '/api/requests'],
        ['POST', '/api/requests'],
        ['GET', '/api/requests/abc-uuid-123'],
        ['GET', '/api/requests/00000000-0000-0000-0000-000000000000'],
        ['GET', '/api/admin/metrics'],
        ['GET', '/api/admin/downloads/active'],
        ['GET', '/api/admin/requests/recent'],
      ];

      for (const [method, path] of allowedCalls) {
        vi.clearAllMocks();
        prismaMock.apiToken.findUnique.mockResolvedValue({
          id: 'token-1',
          tokenHash: testTokenHash,
          role: 'admin',
          expiresAt: null,
          tokenUser: {
            id: 'user-1',
            plexUsername: 'activeuser',
            role: 'admin',
            deletedAt: null,
          },
        });
        prismaMock.apiToken.update.mockResolvedValue({});
        const { requireAuth } = await import('@/lib/middleware/auth');

        const handler = vi.fn(async () => NextResponse.json({ ok: true }));
        const response = await requireAuth(
          makeRequest(`Bearer ${testToken}`, path, method) as any,
          handler
        );

        expect(handler, `${method} ${path}`).toHaveBeenCalled();
        expect(response.status, `${method} ${path}`).toBe(200);
      }
    });

    it('blocks API tokens on sibling sub-routes of /api/requests/:id', async () => {
      const blockedCalls: Array<[string, string]> = [
        ['GET', '/api/requests/abc/select-torrent'],
        ['GET', '/api/requests/abc/download-token'],
        ['GET', '/api/requests/abc/interactive-search'],
        ['POST', '/api/requests/abc/manual-search'],
        ['POST', '/api/requests/abc/select-ebook'],
      ];

      for (const [method, path] of blockedCalls) {
        vi.clearAllMocks();
        prismaMock.apiToken.findUnique.mockResolvedValue({
          id: 'token-1',
          tokenHash: testTokenHash,
          role: 'admin',
          expiresAt: null,
          tokenUser: {
            id: 'user-1',
            plexUsername: 'activeuser',
            role: 'admin',
            deletedAt: null,
          },
        });
        prismaMock.apiToken.update.mockResolvedValue({});
        const { requireAuth } = await import('@/lib/middleware/auth');

        const handler = vi.fn();
        const response = await requireAuth(
          makeRequest(`Bearer ${testToken}`, path, method) as any,
          handler
        );

        expect(handler, `${method} ${path} should be blocked`).not.toHaveBeenCalled();
        expect(response.status, `${method} ${path}`).toBe(403);
      }
    });

    it('does not restrict JWT-authenticated users to the allowlist', async () => {
      verifyAccessTokenMock.mockReturnValue({
        sub: 'user-1',
        plexId: 'plex-1',
        username: 'user',
        role: 'admin',
        iat: 1,
        exp: 2,
      });
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' });
      const { requireAuth } = await import('@/lib/middleware/auth');

      const handler = vi.fn(async () => NextResponse.json({ ok: true }));
      // Use a non-allowlisted endpoint — JWT should still work
      const response = await requireAuth(
        makeRequest('Bearer jwttoken', '/api/admin/settings', 'POST') as any,
        handler
      );

      expect(handler).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });
  });

  describe('getOptionalAuthUser', () => {
    const SEARCH = '/api/audiobooks/search';
    const jwtPayload = { sub: 'user-jwt', plexId: 'plex-jwt', username: 'jwtuser', role: 'admin', iat: 1, exp: 2 };

    it('returns null when no token is present', async () => {
      const { getOptionalAuthUser } = await import('@/lib/middleware/auth');
      expect(await getOptionalAuthUser(makeRequest(undefined, SEARCH) as any)).toBeNull();
    });

    it('returns a checked JWT caller with the role from the account row', async () => {
      verifyAccessTokenMock.mockReturnValue(jwtPayload);
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-jwt', role: 'user', deletedAt: null, sessionsInvalidatedAt: null, registrationStatus: 'approved',
      });
      const { getOptionalAuthUser } = await import('@/lib/middleware/auth');

      const user = await getOptionalAuthUser(makeRequest('Bearer jwttoken', SEARCH) as any);
      expect(user).toMatchObject({ id: 'user-jwt', sub: 'user-jwt', role: 'user' });
    });

    it('returns null for a JWT whose account row is gone', async () => {
      verifyAccessTokenMock.mockReturnValue(jwtPayload);
      prismaMock.user.findUnique.mockResolvedValue(null);
      const { getOptionalAuthUser } = await import('@/lib/middleware/auth');

      expect(await getOptionalAuthUser(makeRequest('Bearer jwttoken', SEARCH) as any)).toBeNull();
    });

    it('returns null for an unverifiable JWT without a lookup', async () => {
      verifyAccessTokenMock.mockReturnValue(null);
      const { getOptionalAuthUser } = await import('@/lib/middleware/auth');

      expect(await getOptionalAuthUser(makeRequest('Bearer badtoken', SEARCH) as any)).toBeNull();
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it('resolves API tokens via apiToken lookup on an allowlisted endpoint', async () => {
      const apiTok = 'rmab_async_test_1234567890';
      const apiTokHash = crypto.createHash('sha256').update(apiTok).digest('hex');
      prismaMock.apiToken.findUnique.mockResolvedValue({
        id: 'token-async',
        tokenHash: apiTokHash,
        role: 'user',
        expiresAt: null,
        tokenUser: {
          id: 'user-api',
          plexId: 'plex-api',
          plexUsername: 'apiuser',
          role: 'user',
          deletedAt: null,
        },
      });
      prismaMock.apiToken.update.mockResolvedValue({});
      const { getOptionalAuthUser } = await import('@/lib/middleware/auth');

      const user = await getOptionalAuthUser(makeRequest(`Bearer ${apiTok}`, SEARCH) as any);
      expect(user).toMatchObject({ id: 'user-api', sub: 'user-api', username: 'apiuser' });
    });

    it('returns null for an API token on an endpoint outside its allowlist, without a lookup', async () => {
      const { getOptionalAuthUser } = await import('@/lib/middleware/auth');

      const user = await getOptionalAuthUser(
        makeRequest('Bearer rmab_async_test_1234567890', '/api/audiobooks/popular') as any
      );
      expect(user).toBeNull();
      expect(prismaMock.apiToken.findUnique).not.toHaveBeenCalled();
    });

    it('returns null for invalid API tokens', async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue(null);
      const { getOptionalAuthUser } = await import('@/lib/middleware/auth');

      expect(await getOptionalAuthUser(makeRequest('Bearer rmab_invalid_token_abc', SEARCH) as any)).toBeNull();
    });
  });
});
