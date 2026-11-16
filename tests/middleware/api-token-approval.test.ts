/**
 * Component: API Token Request Approval Gate Tests
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * A token reaches POST /api/admin/requests/:id/approve only when the admin setting is on, the token
 * was created with canApproveRequests, and its owner is still an admin. Sessions are unaffected.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const verifyAccessTokenMock = vi.fn();

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/jwt', () => ({ verifyAccessToken: verifyAccessTokenMock }));

const TOKEN = 'rmab_approval1234567890';
const APPROVE_PATH = '/api/admin/requests/req-1/approve';

const makeRequest = (authHeader: string, pathname = APPROVE_PATH, method = 'POST') => ({
  method,
  nextUrl: { pathname },
  headers: { get: (key: string) => (key.toLowerCase() === 'authorization' ? authHeader : null) },
});

function givenToken({ canApproveRequests = true, tokenRole = 'admin', ownerRole = 'admin' } = {}) {
  prismaMock.apiToken.findUnique.mockResolvedValue({
    id: 'token-1',
    name: 'Absorb',
    tokenPrefix: 'rmab_approv',
    role: tokenRole,
    canApproveRequests,
    expiresAt: null,
    tokenUser: { id: 'admin-1', plexId: 'p-1', plexUsername: 'boss', role: ownerRole, deletedAt: null },
  });
  prismaMock.apiToken.update.mockResolvedValue({});
}

const givenSetting = (value: string | null) =>
  prismaMock.configuration.findUnique.mockResolvedValue(value === null ? null : { key: 'api_tokens.allow_request_approval', value });

async function callApprove(path = APPROVE_PATH, method = 'POST') {
  const { requireAuth } = await import('@/lib/middleware/auth');
  const handler = vi.fn(async (req: any) => NextResponse.json({ token: req.apiToken ?? null }));
  const response = await requireAuth(makeRequest(`Bearer ${TOKEN}`, path, method) as any, handler);
  return { response, handler, body: await response.json() };
}

describe('API token request approval gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets a token through when the setting is on, the token may approve and its owner is an admin', async () => {
    givenToken();
    givenSetting('true');

    const { response, handler, body } = await callApprove();

    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalled();
    expect(body.token).toEqual({ id: 'token-1', name: 'Absorb', tokenPrefix: 'rmab_approv', canApproveRequests: true });
  });

  it('refuses a token created without "Can approve requests", even with the setting on', async () => {
    givenToken({ canApproveRequests: false });
    givenSetting('true');

    const { response, handler, body } = await callApprove();

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect(body.message).toMatch(/cannot approve requests/);
  });

  it.each([null, 'false', ''])('refuses every token while the setting is off (%s)', async (value) => {
    givenToken();
    givenSetting(value);

    const { response, handler, body } = await callApprove();

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect(body.message).toMatch(/Settings → API/);
  });

  it('refuses the token of an owner who is no longer an admin', async () => {
    givenToken({ ownerRole: 'user' });
    givenSetting('true');

    const { response, handler, body } = await callApprove();

    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect(body.message).toMatch(/Only an admin/);
  });

  it('reads the setting from the database on every call, so turning it off applies at once', async () => {
    givenToken();
    givenSetting('true');
    expect((await callApprove()).response.status).toBe(200);

    givenSetting('false');
    expect((await callApprove()).response.status).toBe(403);
  });

  it('keeps the pending-approval list and other approval routes closed to tokens', async () => {
    givenToken();
    givenSetting('true');

    for (const [method, path] of [
      ['GET', '/api/admin/requests/pending-approval'],
      ['GET', APPROVE_PATH],
      ['POST', '/api/admin/requests/req-1/approve/extra'],
    ]) {
      const { response, handler } = await callApprove(path, method);
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it('never consults the setting for other allowlisted endpoints', async () => {
    givenToken({ canApproveRequests: false });

    const { response } = await callApprove('/api/requests', 'GET');

    expect(response.status).toBe(200);
    expect(prismaMock.configuration.findUnique).not.toHaveBeenCalled();
  });

  it('leaves logged-in sessions alone: no allowlist, no setting, no token details', async () => {
    verifyAccessTokenMock.mockReturnValue({ sub: 'admin-1', plexId: 'p-1', username: 'boss', role: 'admin', iat: 1, exp: 2 });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin', deletedAt: null, sessionsInvalidatedAt: null });
    const { requireAuth } = await import('@/lib/middleware/auth');
    const handler = vi.fn(async (req: any) => NextResponse.json({ token: req.apiToken ?? null }));

    const response = await requireAuth(makeRequest('Bearer jwt-token') as any, handler);

    expect(handler).toHaveBeenCalled();
    expect((await response.json()).token).toBeNull();
    expect(prismaMock.configuration.findUnique).not.toHaveBeenCalled();
  });

  it('getOptionalAuthUser gives no caller for a token the gate refuses', async () => {
    givenToken({ canApproveRequests: false });
    givenSetting('true');
    const { getOptionalAuthUser } = await import('@/lib/middleware/auth');

    expect(await getOptionalAuthUser(makeRequest(`Bearer ${TOKEN}`) as any)).toBeNull();
  });
});
