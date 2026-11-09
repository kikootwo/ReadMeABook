/**
 * Component: Deleted Plex User Credential Tests
 * Documentation: documentation/backend/services/auth.md
 *
 * An admin deletes a Plex user through the real DELETE /api/admin/users/:id route; every
 * credential that account held stops working at once: access token, refresh token, API
 * token and download link (the deleted-account checks in requireAuth / getSessionRefusal).
 * Each test first shows the credential working, then deletes, then retries it.
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usersDb, type UserRow } from '../helpers/in-memory-users';
import { generateAccessToken, generateDownloadToken, generateRefreshToken } from '@/lib/utils/jwt';

vi.mock('@/lib/db', async () => ({ prisma: (await import('../helpers/in-memory-users')).usersDb.prisma }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: async () => null }) }));

let adminBearer: string;
let plexUser: UserRow;

function bearerFor(user: UserRow) {
  return `Bearer ${generateAccessToken({ sub: user.id, plexId: user.plexId, username: user.plexUsername, role: user.role })}`;
}

async function deleteUser(id: string) {
  const { DELETE } = await import('@/app/api/admin/users/[id]/route');
  const request = new NextRequest(`http://localhost/api/admin/users/${id}`, {
    method: 'DELETE', headers: { authorization: adminBearer },
  });
  return (await DELETE(request, { params: Promise.resolve({ id }) })).status;
}

/** A signed-in call through the real requireAuth. */
async function callAs(authorization: string, path = '/api/requests') {
  const { requireAuth } = await import('@/lib/middleware/auth');
  const request = new NextRequest(`http://localhost${path}`, { headers: { authorization } });
  const response = await requireAuth(request, async (req) => NextResponse.json({ userId: req.user?.id }));
  return { status: response.status, body: await response.json() };
}

describe('a deleted Plex user\'s credentials are refused at once', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usersDb.reset();
    const admin = usersDb.addUser({
      plexId: 'local-admin', plexUsername: 'admin', role: 'admin', isSetupAdmin: true, authProvider: 'local',
    });
    adminBearer = bearerFor(admin);
    plexUser = usersDb.addUser({ plexId: '1001', plexUsername: 'pat', role: 'user', authProvider: 'plex', downloadAccess: true });
  });

  it('access token', async () => {
    const bearer = bearerFor(plexUser);
    expect(await callAs(bearer)).toEqual({ status: 200, body: { userId: plexUser.id } });

    const deleteStatus = await deleteUser(plexUser.id);

    expect(await callAs(bearer)).toMatchObject({ status: 401 });
    expect(deleteStatus).toBe(200);
  });

  it('refresh token', async () => {
    const refreshToken = generateRefreshToken(plexUser.id);
    const refresh = async () => {
      const { POST } = await import('@/app/api/auth/refresh/route');
      const response = await POST(new NextRequest('http://localhost/api/auth/refresh', {
        method: 'POST', body: JSON.stringify({ refreshToken }), headers: { 'content-type': 'application/json' },
      }));
      return { status: response.status, body: await response.json() };
    };
    expect(await refresh()).toMatchObject({ status: 200, body: { success: true } });

    const deleteStatus = await deleteUser(plexUser.id);

    expect(await refresh()).toEqual({ status: 401, body: { error: 'Unauthorized', message: 'User not found' } });
    expect(deleteStatus).toBe(200);
  });

  it('API token', async () => {
    const token = 'rmab_' + 'a'.repeat(40);
    usersDb.addApiToken({
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'), tokenPrefix: 'rmab_aaaa', userId: plexUser.id,
    });
    expect(await callAs(`Bearer ${token}`)).toEqual({ status: 200, body: { userId: plexUser.id } });

    const deleteStatus = await deleteUser(plexUser.id);

    expect(await callAs(`Bearer ${token}`)).toEqual({
      status: 401, body: { error: 'Unauthorized', message: 'Invalid or expired API token' },
    });
    expect(deleteStatus).toBe(200);
  });

  it('download link', async () => {
    const link = generateDownloadToken(plexUser.id, 'req-1');
    const download = async () => {
      const { GET } = await import('@/app/api/requests/[id]/download/route');
      const response = await GET(
        new NextRequest(`http://localhost/api/requests/req-1/download?token=${link}`),
        { params: Promise.resolve({ id: 'req-1' }) }
      );
      return { status: response.status, body: await response.json() };
    };
    // Past the account check (no request row in this table, so 404)
    expect(await download()).toMatchObject({ status: 404, body: { message: 'Request not found' } });

    const deleteStatus = await deleteUser(plexUser.id);

    expect(await download()).toEqual({
      status: 401, body: { error: 'Unauthorized', message: 'Invalid or expired download token' },
    });
    expect(deleteStatus).toBe(200);
  });
});
