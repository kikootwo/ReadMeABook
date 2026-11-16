/**
 * Component: Admin User Discord Link Route Tests
 * Documentation: documentation/admin-dashboard.md
 *
 * Runs the real requireAuth -> requireAdmin chain (JWT verify and DB mocked) so the
 * user-session and API-token refusals are the middleware's own answers.
 */

import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const verifyAccessTokenMock = vi.hoisted(() => vi.fn());
const logLines = vi.hoisted(() => [] as unknown[][]);

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/utils/jwt', () => ({
  verifyAccessToken: verifyAccessTokenMock,
}));

vi.mock('@/lib/utils/logger', () => {
  const record = (...args: unknown[]) => { logLines.push(args); };
  return { RMABLogger: { create: () => ({ info: record, debug: record, warn: record, error: record }) } };
});

const LINK_ID = '123456789012345678';
const INVALID_ID_MESSAGE = 'Discord user ID must be 15 to 20 digits, not starting with 0, or empty to unlink';
const API_TOKEN = 'rmab_discord1234567890abcd';
const API_TOKEN_HASH = crypto.createHash('sha256').update(API_TOKEN).digest('hex');

const sessionPayload = (sub: string) => ({ sub, plexId: `local-${sub}`, username: sub, role: 'admin', iat: 100, exp: 200 });

const accountRow = (id: string, role: string) => ({
  id,
  plexId: `local-${id}`,
  plexUsername: id,
  role,
  deletedAt: null,
  sessionsInvalidatedAt: null,
  registrationStatus: 'approved',
});

/** Signs in as `admin-1` (role from the account row) unless told otherwise. */
function signInAs(role: 'admin' | 'user', sub = 'admin-1') {
  verifyAccessTokenMock.mockReturnValue(sessionPayload(sub));
  prismaMock.user.findUnique.mockResolvedValue(accountRow(sub, role));
}

function putRequest(id: string, body: unknown, auth = 'Bearer jwt'): NextRequest {
  return new NextRequest(`http://localhost/api/admin/users/${id}/discord`, {
    method: 'PUT',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function put(id: string, body: unknown, auth?: string) {
  const { PUT } = await import('@/app/api/admin/users/[id]/discord/route');
  const response = await PUT(putRequest(id, body, auth), { params: Promise.resolve({ id }) });
  return { status: response.status, payload: await response.json() };
}

describe('PUT /api/admin/users/[id]/discord', () => {
  beforeEach(() => {
    logLines.length = 0;
    signInAs('admin');
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.apiToken.update.mockResolvedValue({});
  });

  it('links another user and returns the stored value', async () => {
    const { status, payload } = await put('user-2', { discordUserId: LINK_ID });

    expect(status).toBe(200);
    expect(payload).toEqual({ user: { id: 'user-2', discordUserId: LINK_ID } });
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-2', deletedAt: null },
      data: { discordUserId: LINK_ID },
    });
  });

  it('logs the linked Discord ID with the user and the admin', async () => {
    await put('user-2', { discordUserId: LINK_ID });

    expect(logLines).toContainEqual([
      'Discord account linked',
      { userId: 'user-2', adminId: 'admin-1', discordUserId: LINK_ID },
    ]);
  });

  it('logs an unlink with a null Discord ID', async () => {
    await put('user-2', { discordUserId: null });

    expect(logLines).toContainEqual([
      'Discord account unlinked',
      { userId: 'user-2', adminId: 'admin-1', discordUserId: null },
    ]);
  });

  it.each([['15 digits', '1'.repeat(15)], ['20 digits', '9'.repeat(20)]])('accepts %s', async (_label, value) => {
    const { status, payload } = await put('user-2', { discordUserId: value });

    expect(status).toBe(200);
    expect(payload.user.discordUserId).toBe(value);
  });

  it('trims surrounding spaces before storing', async () => {
    const { status, payload } = await put('user-2', { discordUserId: `  ${LINK_ID} ` });

    expect(status).toBe(200);
    expect(payload.user.discordUserId).toBe(LINK_ID);
  });

  it.each([[null], [''], ['   ']])('clears the link for %j', async (value) => {
    const { status, payload } = await put('user-2', { discordUserId: value });

    expect(status).toBe(200);
    expect(payload).toEqual({ user: { id: 'user-2', discordUserId: null } });
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-2', deletedAt: null },
      data: { discordUserId: null },
    });
  });

  it('lets an admin link their own account and never writes the role, even when sent', async () => {
    const { status } = await put('admin-1', { discordUserId: LINK_ID, role: 'user', isSetupAdmin: true });

    expect(status).toBe(200);
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'admin-1', deletedAt: null },
      data: { discordUserId: LINK_ID },
    });
  });

  it.each([
    ['too short', '12345'],
    ['14 digits', '1'.repeat(14)],
    ['21 digits', '1'.repeat(21)],
    ['a leading zero', `0${LINK_ID}`],
    ['too long', '1'.repeat(26)],
    ['not digits', '12345678901234567a'],
    ['a mention', `<@${LINK_ID}>`],
    ['a number', 123456789012345678],
  ])('refuses %s with 400', async (_label, value) => {
    const { status, payload } = await put('user-2', { discordUserId: value });

    expect(status).toBe(400);
    expect(payload.error).toBe('ValidationError');
    expect(payload.message).toBe(INVALID_ID_MESSAGE);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a body without discordUserId, and a body that is not JSON, with 400', async () => {
    expect((await put('user-2', {})).status).toBe(400);
    expect((await put('user-2', '{not json')).status).toBe(400);
    expect((await put('user-2', '[]')).status).toBe(400);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('answers 409 when the Discord ID is linked to another account', async () => {
    prismaMock.user.updateMany.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

    const { status, payload } = await put('user-2', { discordUserId: LINK_ID });

    expect(status).toBe(409);
    expect(payload).toEqual({ error: 'Conflict', message: 'This Discord account is already linked to another user' });
  });

  it('answers 404 for a missing or deleted user (the write matches no row)', async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });

    const { status, payload } = await put('gone', { discordUserId: LINK_ID });

    expect(status).toBe(404);
    expect(payload.error).toBe('User not found');
  });

  it('answers 500 without detail when the write fails for another reason', async () => {
    prismaMock.user.updateMany.mockRejectedValue(new Error('connection reset'));

    const { status, payload } = await put('user-2', { discordUserId: LINK_ID });

    expect(status).toBe(500);
    expect(JSON.stringify(payload)).not.toContain('connection reset');
  });

  it('answers 413 for a body over the limit', async () => {
    const { status } = await put('user-2', { discordUserId: LINK_ID, padding: 'x'.repeat(70 * 1024) });

    expect(status).toBe(413);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a signed-in user who is not an admin with 403', async () => {
    signInAs('user', 'user-3');

    const { status, payload } = await put('user-3', { discordUserId: LINK_ID });

    expect(status).toBe(403);
    expect(payload.message).toBe('Admin access required');
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses an admin API token with 403: the route is not on the API-token allowlist', async () => {
    prismaMock.apiToken.findUnique.mockResolvedValue({
      id: 'token-1',
      tokenHash: API_TOKEN_HASH,
      tokenPrefix: 'rmab_dis',
      role: 'admin',
      expiresAt: null,
      tokenUser: accountRow('admin-1', 'admin'),
    });

    const { status, payload } = await put('user-2', { discordUserId: LINK_ID }, `Bearer ${API_TOKEN}`);

    expect(status).toBe(403);
    expect(payload.message).toBe('This endpoint is not available via API token authentication');
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('is not on the API-token allowlist', async () => {
    const { isEndpointAllowed } = await import('@/lib/constants/api-tokens');

    expect(isEndpointAllowed('PUT', '/api/admin/users/user-2/discord')).toBe(false);
  });
});
