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

const makeRequest = (authHeader?: string) => ({
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

    it('accepts valid API tokens for active users', async () => {
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
      const response = await requireAuth(makeRequest(`Bearer ${testToken}`) as any, handler);
      const payload = await response.json();

      expect(handler).toHaveBeenCalled();
      expect(payload.userId).toBe('user-1');
    });
  });

  it('returns current user from token', async () => {
    verifyAccessTokenMock.mockReturnValue({
      sub: 'user-1',
      plexId: 'plex-1',
      username: 'user',
      role: 'admin',
      iat: 1,
      exp: 2,
    });
    const { getCurrentUser, isAdmin } = await import('@/lib/middleware/auth');

    const payload = getCurrentUser(makeRequest('Bearer token') as any);
    expect(payload?.sub).toBe('user-1');
    expect(isAdmin(payload)).toBe(true);
  });
});
