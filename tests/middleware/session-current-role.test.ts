/**
 * Component: Session Current Role Tests
 * Documentation: documentation/backend/services/auth.md
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const verifyAccessTokenMock = vi.hoisted(() => vi.fn());
const verifyRefreshTokenMock = vi.hoisted(() => vi.fn());
const generateAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/utils/jwt', () => ({
  verifyAccessToken: verifyAccessTokenMock,
  verifyRefreshToken: verifyRefreshTokenMock,
  generateAccessToken: generateAccessTokenMock,
}));

const API_TOKEN = 'rmab_role1234567890abcdef';
const API_TOKEN_HASH = crypto.createHash('sha256').update(API_TOKEN).digest('hex');

const makeRequest = (authHeader: string, pathname = '/api/admin/metrics') => ({
  method: 'GET',
  nextUrl: { pathname },
  headers: {
    get: (key: string) => (key.toLowerCase() === 'authorization' ? authHeader : null),
  },
});

const accessPayload = (role: string) => ({
  sub: 'user-1',
  plexId: 'local-reader',
  username: 'reader',
  role,
  iat: 100,
  exp: 200,
});

const userRow = (role: string) => ({
  id: 'user-1',
  plexId: 'local-reader',
  plexUsername: 'reader',
  role,
  deletedAt: null,
  sessionsInvalidatedAt: null,
  registrationStatus: 'approved',
});

const tokenRow = (tokenRole: string, accountRole: string) => ({
  id: 'token-1',
  tokenHash: API_TOKEN_HASH,
  tokenPrefix: 'rmab_rol',
  role: tokenRole,
  expiresAt: null,
  tokenUser: userRow(accountRole),
});

/** Runs a request through the same requireAuth -> requireAdmin chain admin routes use. */
async function callAdminRoute(authHeader: string) {
  const { requireAuth, requireAdmin } = await import('@/lib/middleware/auth');
  const handler = vi.fn(async (req: any) => NextResponse.json({ role: req.user?.role }));
  const response = await requireAuth(makeRequest(authHeader) as any, (req) =>
    requireAdmin(req, handler)
  );
  return { response, handler };
}

describe('admin checks use the account current role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyRefreshTokenMock.mockReturnValue({ sub: 'user-1', iat: 100 });
    generateAccessTokenMock.mockReturnValue('new-access-token');
    prismaMock.apiToken.update.mockResolvedValue({});
  });

  describe('access token', () => {
    it('refuses an admin route with 403 when the account is now a user', async () => {
      verifyAccessTokenMock.mockReturnValue(accessPayload('admin'));
      prismaMock.user.findUnique.mockResolvedValue(userRow('user'));

      const { response, handler } = await callAdminRoute('Bearer jwt');

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'Forbidden',
        message: 'Admin access required',
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it('allows an admin route when the account is now an admin', async () => {
      verifyAccessTokenMock.mockReturnValue(accessPayload('user'));
      prismaMock.user.findUnique.mockResolvedValue(userRow('admin'));

      const { response, handler } = await callAdminRoute('Bearer jwt');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ role: 'admin' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('puts the current role on request.user and keeps the other token fields', async () => {
      verifyAccessTokenMock.mockReturnValue(accessPayload('admin'));
      prismaMock.user.findUnique.mockResolvedValue(userRow('user'));
      const { requireAuth } = await import('@/lib/middleware/auth');
      const handler = vi.fn(async (req: any) => NextResponse.json(req.user));

      const response = await requireAuth(makeRequest('Bearer jwt', '/api/requests') as any, handler);

      expect(await response.json()).toEqual({
        sub: 'user-1',
        id: 'user-1',
        plexId: 'local-reader',
        username: 'reader',
        role: 'user',
        iat: 100,
        exp: 200,
      });
    });

    it('reads the role in the one existing user lookup', async () => {
      verifyAccessTokenMock.mockReturnValue(accessPayload('admin'));
      prismaMock.user.findUnique.mockResolvedValue(userRow('admin'));

      await callAdminRoute('Bearer jwt');

      expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.findUnique.mock.calls[0][0].select).toMatchObject({ role: true });
    });

    it('refuses the local admin check when the account is now a user', async () => {
      verifyAccessTokenMock.mockReturnValue(accessPayload('admin'));
      // A setup admin row, so only the role decides the answer
      prismaMock.user.findUnique.mockResolvedValue({ ...userRow('user'), isSetupAdmin: true });
      const { requireAuth, requireLocalAdmin } = await import('@/lib/middleware/auth');
      const handler = vi.fn(async () => NextResponse.json({ ok: true }));

      const response = await requireAuth(makeRequest('Bearer jwt') as any, (req) =>
        requireLocalAdmin(req, handler)
      );

      expect(response.status).toBe(403);
      expect(handler).not.toHaveBeenCalled();
      expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('API token', () => {
    it('refuses an admin route with 403 when the account is now a user', async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow('admin', 'user'));

      const { response, handler } = await callAdminRoute(`Bearer ${API_TOKEN}`);

      expect(response.status).toBe(403);
      expect(handler).not.toHaveBeenCalled();
    });

    it('keeps admin access while the account is still an admin', async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow('admin', 'admin'));

      const { response } = await callAdminRoute(`Bearer ${API_TOKEN}`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ role: 'admin' });
    });

    it('does not raise a user token to admin when the account is promoted', async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow('user', 'admin'));

      const { response, handler } = await callAdminRoute(`Bearer ${API_TOKEN}`);

      expect(response.status).toBe(403);
      expect(handler).not.toHaveBeenCalled();
    });

    it('reports the current role from getCurrentUserAsync with no extra lookup', async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow('admin', 'user'));
      const { getCurrentUserAsync } = await import('@/lib/middleware/auth');

      const user = await getCurrentUserAsync(makeRequest(`Bearer ${API_TOKEN}`) as any);

      expect(user?.role).toBe('user');
      expect(prismaMock.apiToken.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/refresh', () => {
    const refreshRequest = () => ({ json: vi.fn().mockResolvedValue({ refreshToken: 'refresh' }) });

    it.each(['user', 'admin'])('issues an access token with the current role (%s)', async (role) => {
      prismaMock.user.findUnique.mockResolvedValue(userRow(role));
      const { POST } = await import('@/app/api/auth/refresh/route');

      const response = await POST(refreshRequest() as any);

      expect(response.status).toBe(200);
      expect(generateAccessTokenMock).toHaveBeenCalledWith({
        sub: 'user-1',
        plexId: 'local-reader',
        username: 'reader',
        role,
      });
      expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    });
  });
});
