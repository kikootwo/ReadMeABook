/**
 * Component: Session Account Status Tests
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

const API_TOKEN = 'rmab_status1234567890abcdef';
const API_TOKEN_HASH = crypto.createHash('sha256').update(API_TOKEN).digest('hex');

const makeRequest = (authHeader: string) => ({
  method: 'GET',
  nextUrl: { pathname: '/api/requests' },
  headers: {
    get: (key: string) => (key.toLowerCase() === 'authorization' ? authHeader : null),
  },
});

type Row = { registrationStatus: string | null; deletedAt: Date | null };

const REFUSED: Array<[string, Row]> = [
  ['pending', { registrationStatus: 'pending_approval', deletedAt: null }],
  ['rejected', { registrationStatus: 'rejected', deletedAt: null }],
  ['deleted', { registrationStatus: 'approved', deletedAt: new Date('2026-01-01T00:00:00Z') }],
];

const ALLOWED: Array<[string, Row]> = [
  ['approved', { registrationStatus: 'approved', deletedAt: null }],
  ['null status', { registrationStatus: null, deletedAt: null }],
];

const userRow = (row: Row) => ({
  id: 'user-1',
  plexId: 'local-reader',
  plexUsername: 'reader',
  role: 'user',
  sessionsInvalidatedAt: null,
  ...row,
});

describe('signed-in sessions follow the account status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAccessTokenMock.mockReturnValue({
      sub: 'user-1',
      plexId: 'local-reader',
      username: 'reader',
      role: 'user',
      iat: 100,
      exp: 200,
    });
    verifyRefreshTokenMock.mockReturnValue({ sub: 'user-1', iat: 100 });
    generateAccessTokenMock.mockReturnValue('new-access-token');
    prismaMock.apiToken.update.mockResolvedValue({});
  });

  describe('requireAuth with an access token', () => {
    it('reads the status in the one existing user lookup', async () => {
      prismaMock.user.findUnique.mockResolvedValue(userRow(ALLOWED[0][1]));
      const { requireAuth } = await import('@/lib/middleware/auth');

      await requireAuth(makeRequest('Bearer jwt') as any, vi.fn(async () => NextResponse.json({})));

      expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.findUnique.mock.calls[0][0].select).toMatchObject({
        deletedAt: true,
        registrationStatus: true,
      });
    });

    it.each(REFUSED)('refuses a %s account with 401 User not found', async (_label, row) => {
      prismaMock.user.findUnique.mockResolvedValue(userRow(row));
      const { requireAuth } = await import('@/lib/middleware/auth');
      const handler = vi.fn(async () => NextResponse.json({ reached: true }));

      const response = await requireAuth(makeRequest('Bearer jwt') as any, handler);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized', message: 'User not found' });
      expect(handler).not.toHaveBeenCalled();
    });

    it.each(ALLOWED)('lets an %s account through', async (_label, row) => {
      prismaMock.user.findUnique.mockResolvedValue(userRow(row));
      const { requireAuth } = await import('@/lib/middleware/auth');
      const handler = vi.fn(async (req: any) => NextResponse.json({ userId: req.user?.id }));

      const response = await requireAuth(makeRequest('Bearer jwt') as any, handler);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ userId: 'user-1' });
    });
  });

  describe('requireAuth with an API token', () => {
    const tokenRow = (row: Row) => ({
      id: 'token-1',
      tokenHash: API_TOKEN_HASH,
      tokenPrefix: 'rmab_sta',
      role: 'user',
      expiresAt: null,
      tokenUser: userRow(row),
    });

    it('reads the status in the one existing token lookup', async () => {
      prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow(ALLOWED[0][1]));
      const { requireAuth } = await import('@/lib/middleware/auth');

      await requireAuth(makeRequest(`Bearer ${API_TOKEN}`) as any, vi.fn(async () => NextResponse.json({})));

      expect(prismaMock.apiToken.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.apiToken.findUnique.mock.calls[0][0].include.tokenUser.select).toMatchObject({
        deletedAt: true,
        registrationStatus: true,
      });
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it.each(REFUSED)('refuses a %s account with 401 Invalid or expired API token', async (_label, row) => {
      prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow(row));
      const { requireAuth } = await import('@/lib/middleware/auth');
      const handler = vi.fn(async () => NextResponse.json({ reached: true }));

      const response = await requireAuth(makeRequest(`Bearer ${API_TOKEN}`) as any, handler);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: 'Unauthorized',
        message: 'Invalid or expired API token',
      });
      expect(handler).not.toHaveBeenCalled();
      expect(prismaMock.apiToken.update).not.toHaveBeenCalled();
    });

    it.each(ALLOWED)('lets an %s account through', async (_label, row) => {
      prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow(row));
      const { requireAuth } = await import('@/lib/middleware/auth');
      const handler = vi.fn(async (req: any) => NextResponse.json({ userId: req.user?.id }));

      const response = await requireAuth(makeRequest(`Bearer ${API_TOKEN}`) as any, handler);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ userId: 'user-1' });
    });
  });

  describe('getOptionalAuthUser with an API token', () => {
    const tokenRow = (row: Row) => ({
      id: 'token-1',
      tokenHash: API_TOKEN_HASH,
      tokenPrefix: 'rmab_sta',
      role: 'user',
      expiresAt: null,
      tokenUser: userRow(row),
    });

    it.each(REFUSED)('returns null for a %s account', async (_label, row) => {
      prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow(row));
      const { getOptionalAuthUser } = await import('@/lib/middleware/auth');

      expect(await getOptionalAuthUser(makeRequest(`Bearer ${API_TOKEN}`) as any)).toBeNull();
      expect(prismaMock.apiToken.update).not.toHaveBeenCalled();
    });

    it.each(ALLOWED)('returns the token owner for an %s account', async (_label, row) => {
      prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow(row));
      const { getOptionalAuthUser } = await import('@/lib/middleware/auth');

      expect(await getOptionalAuthUser(makeRequest(`Bearer ${API_TOKEN}`) as any)).toEqual({
        id: 'user-1',
        sub: 'user-1',
        plexId: 'local-reader',
        username: 'reader',
        role: 'user',
      });
    });
  });

  describe('POST /api/auth/refresh', () => {
    const refreshRequest = () => ({ json: vi.fn().mockResolvedValue({ refreshToken: 'refresh' }) });

    it('reads the status in the one existing user lookup', async () => {
      prismaMock.user.findUnique.mockResolvedValue(userRow(ALLOWED[0][1]));
      const { POST } = await import('@/app/api/auth/refresh/route');

      await POST(refreshRequest() as any);

      expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.findUnique.mock.calls[0][0].select).toMatchObject({
        deletedAt: true,
        registrationStatus: true,
      });
    });

    it.each(REFUSED)('refuses a %s account with 401 User not found', async (_label, row) => {
      prismaMock.user.findUnique.mockResolvedValue(userRow(row));
      const { POST } = await import('@/app/api/auth/refresh/route');

      const response = await POST(refreshRequest() as any);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized', message: 'User not found' });
      expect(generateAccessTokenMock).not.toHaveBeenCalled();
    });

    it.each(ALLOWED)('issues a new access token for an %s account', async (_label, row) => {
      prismaMock.user.findUnique.mockResolvedValue(userRow(row));
      const { POST } = await import('@/app/api/auth/refresh/route');

      const response = await POST(refreshRequest() as any);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        success: true,
        accessToken: 'new-access-token',
        expiresIn: 3600,
      });
    });
  });
});
