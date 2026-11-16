/**
 * Component: API Token Permission Gate Tests (approve_requests)
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * The real requireAuth and getOptionalAuthUser with Prisma mocked: each gate on its own refuses,
 * all passing reaches the handler with req.apiToken set.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const verifyAccessTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/jwt', () => ({ verifyAccessToken: verifyAccessTokenMock }));

const DAY = 24 * 60 * 60 * 1000;
const TOKEN = 'rmab_gate_test_0123456789abcdef';
const APPROVE = '/api/admin/requests/req-1/approve';
const SETTING_KEY = 'api_tokens.allow_request_approval';

const makeRequest = (authHeader: string, pathname = APPROVE, method = 'POST') => ({
  method,
  nextUrl: { pathname },
  headers: { get: (key: string) => (key.toLowerCase() === 'authorization' ? authHeader : null) },
});

function tokenRow(overrides: Record<string, unknown> = {}, user: Record<string, unknown> = {}) {
  const createdAt = new Date(Date.now() - 1000);
  return {
    id: 'tok-1',
    name: 'Approver',
    tokenPrefix: 'rmab_gate_te',
    role: 'admin',
    canApproveRequests: true,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 90 * DAY),
    tokenUser: { id: 'admin-1', plexId: 'local-admin', plexUsername: 'admin', role: 'admin', deletedAt: null, registrationStatus: 'approved', ...user },
    ...overrides,
  };
}

function setting(value: string | null) {
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: any) =>
    where.key === SETTING_KEY && value !== null ? { key: SETTING_KEY, value } : null
  );
}

const settingReads = () =>
  prismaMock.configuration.findUnique.mock.calls.filter(([arg]: any) => arg?.where?.key === SETTING_KEY).length;

async function callApprove(header = `Bearer ${TOKEN}`, path = APPROVE, method = 'POST') {
  const { requireAuth } = await import('@/lib/middleware/auth');
  const handler = vi.fn(async (req: any) => NextResponse.json({ ok: true, apiToken: req.apiToken ?? null, role: req.user?.role }));
  const response = await requireAuth(makeRequest(header, path, method) as any, handler);
  return { status: response.status, body: await response.json(), handler };
}

describe('approve_requests permission gate (requireAuth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.apiToken.update.mockResolvedValue({});
    setting('true');
  });

  it('all gates pass: the handler runs with req.apiToken (no secret) and the admin role', async () => {
    prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow());
    const result = await callApprove();

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      role: 'admin',
      apiToken: { id: 'tok-1', name: 'Approver', tokenPrefix: 'rmab_gate_te', canApproveRequests: true },
    });
    expect(settingReads()).toBe(1);
  });

  it.each([
    ['the token flag is false', tokenRow({ canApproveRequests: false }), 'This API token is not allowed to approve requests.'],
    ['the token flag is missing', tokenRow({ canApproveRequests: undefined }), 'This API token is not allowed to approve requests.'],
    ['the owner was demoted', tokenRow({}, { role: 'user' }), 'Approving requests with an API token needs an admin account.'],
    ['the token has the user role', tokenRow({ role: 'user' }), 'Approving requests with an API token needs an admin account.'],
  ])('refuses with 403 when %s, without reading the setting', async (_label, row, message) => {
    prismaMock.apiToken.findUnique.mockResolvedValue(row);
    const result = await callApprove();

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Forbidden', message });
    expect(result.handler).not.toHaveBeenCalled();
    expect(settingReads()).toBe(0);
  });

  it.each([[null], ['false'], ['TRUE'], ['1'], [' true']])('refuses with 403 when the setting is %s', async (value) => {
    setting(value);
    prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow());
    const result = await callApprove();

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'Forbidden', message: 'Approving requests with API tokens is turned off in Settings → API.' });
    expect(result.handler).not.toHaveBeenCalled();
  });

  it('refuses with 403 when a flagged token has no expiry', async () => {
    prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow({ expiresAt: null }));
    const result = await callApprove();

    expect(result.status).toBe(403);
    expect(result.body.message).toBe('A token that approves requests must expire within 90 days of its creation.');
    expect(result.handler).not.toHaveBeenCalled();
    expect(settingReads()).toBe(0);
  });

  it('refuses with 403 when a flagged token expires more than 90 days + 24 h after creation', async () => {
    const createdAt = new Date(Date.now() - DAY);
    prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow({ createdAt, expiresAt: new Date(createdAt.getTime() + 91 * DAY + 1) }));
    const result = await callApprove();

    expect(result.status).toBe(403);
    expect(result.body.message).toBe('A token that approves requests must expire within 90 days of its creation.');
    expect(result.handler).not.toHaveBeenCalled();
  });

  it('accepts a flagged token expiring exactly 90 days + 24 h after creation', async () => {
    const createdAt = new Date(Date.now() - DAY);
    prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow({ createdAt, expiresAt: new Date(createdAt.getTime() + 91 * DAY) }));
    expect((await callApprove()).status).toBe(200);
  });

  it('an expired token is 401 before any permission or setting read', async () => {
    prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow());
    expect((await callApprove()).status).toBe(200);
    expect(settingReads()).toBe(1);

    prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow({ createdAt: new Date(Date.now() - 91 * DAY), expiresAt: new Date(Date.now() - 1000) }));
    const result = await callApprove();

    expect(result.status).toBe(401);
    expect(result.body.message).toBe('Invalid or expired API token');
    expect(settingReads()).toBe(1);
  });

  it('a failed setting read answers 503 and the handler never runs', async () => {
    prismaMock.configuration.findUnique.mockRejectedValue(new Error('connection lost'));
    prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow());
    const result = await callApprove();

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: 'ServiceUnavailable', message: 'Could not read the API token approval setting. Try again shortly.' });
    expect(result.handler).not.toHaveBeenCalled();
  });

  it('untagged endpoints never read the setting', async () => {
    prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow({ canApproveRequests: false }));
    const result = await callApprove(`Bearer ${TOKEN}`, '/api/admin/metrics', 'GET');

    expect(result.status).toBe(200);
    expect(result.body.apiToken).toMatchObject({ id: 'tok-1', canApproveRequests: false });
    expect(settingReads()).toBe(0);
  });

  it('a flagged token passes only the approve route; off the allowlist it is still 403 with the allowlist message', async () => {
    prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow());
    expect((await callApprove()).status).toBe(200);
    const result = await callApprove(`Bearer ${TOKEN}`, '/api/admin/requests/req-1/approve-all');

    expect(result.status).toBe(403);
    expect(result.body.message).toBe('This endpoint is not available via API token authentication');
    expect(settingReads()).toBe(1);
  });

  it('a session on the approve path never reads the setting and has no req.apiToken', async () => {
    verifyAccessTokenMock.mockReturnValue({ sub: 'admin-1', plexId: 'p', username: 'admin', role: 'admin', iat: Math.floor(Date.now() / 1000) });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin', deletedAt: null, sessionsInvalidatedAt: null, registrationStatus: 'approved' });
    const result = await callApprove('Bearer eyJhbGciOiJIUzI1NiJ9.session.signature');

    expect(result.status).toBe(200);
    expect(result.body.apiToken).toBeNull();
    expect(settingReads()).toBe(0);
    expect(prismaMock.apiToken.findUnique).not.toHaveBeenCalled();
  });
});

describe('checkTokenPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setting('true');
  });

  const auth = () => ({
    user: { sub: 'admin-1', plexId: 'p', username: 'admin', role: 'admin' },
    token: { id: 'tok-1', name: 'Approver', tokenPrefix: 'rmab_x', canApproveRequests: true },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * DAY),
  });

  it('refuses a permission it does not know', async () => {
    const { checkTokenPermissions } = await import('@/lib/middleware/api-token-auth');
    const access = await checkTokenPermissions(['manage_everything' as any], auth() as any);

    expect(access).toEqual({ ok: false, status: 403, error: 'Forbidden', message: 'This endpoint is not available via API token authentication' });
    expect(settingReads()).toBe(0);
  });

  it('every listed permission must pass (an unknown one after a passing one still refuses)', async () => {
    const { checkTokenPermissions } = await import('@/lib/middleware/api-token-auth');

    expect(await checkTokenPermissions(['approve_requests'], auth() as any)).toEqual({ ok: true });
    expect((await checkTokenPermissions(['approve_requests', 'other' as any], auth() as any)).ok).toBe(false);
    expect(await checkTokenPermissions([], auth() as any)).toEqual({ ok: true });
  });
});

describe('approve_requests permission gate (getOptionalAuthUser)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.apiToken.update.mockResolvedValue({});
    setting('true');
  });

  it('returns the caller when every gate passes', async () => {
    prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow());
    const { getOptionalAuthUser } = await import('@/lib/middleware/auth');

    expect(await getOptionalAuthUser(makeRequest(`Bearer ${TOKEN}`) as any)).toMatchObject({ id: 'admin-1', role: 'admin' });
  });

  it.each([
    ['the flag is false', () => prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow({ canApproveRequests: false }))],
    ['the owner was demoted', () => prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow({}, { role: 'user' }))],
    ['the setting is off', () => { setting('false'); prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow()); }],
    ['the setting read fails', () => { prismaMock.configuration.findUnique.mockRejectedValue(new Error('down')); prismaMock.apiToken.findUnique.mockResolvedValue(tokenRow()); }],
  ])('returns null when %s (refused by the permission check, after the lookup)', async (_label, arrange) => {
    arrange();
    const { getOptionalAuthUser } = await import('@/lib/middleware/auth');

    expect(await getOptionalAuthUser(makeRequest(`Bearer ${TOKEN}`) as any)).toBeNull();
    expect(prismaMock.apiToken.findUnique).toHaveBeenCalledTimes(1);
  });
});
