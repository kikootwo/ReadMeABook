/**
 * Component: Creating approval tokens (user and admin token routes)
 * Documentation: documentation/backend/services/api-tokens.md
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const request = vi.hoisted(() => ({
  user: { id: '11111111-1111-4111-8111-111111111111', sub: '11111111-1111-4111-8111-111111111111', username: 'admin', role: 'admin' },
  payload: undefined as unknown,
  json: async () => request.payload,
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) => handler(request),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/utils/rateLimit', () => ({ checkApiTokenCreateRateLimit: () => ({ allowed: true }) }));
vi.mock('@/lib/utils/api-token', () => ({
  generateApiToken: () => ({ fullToken: 'rmab_full', tokenHash: 'hash', tokenPrefix: 'rmab_full123' }),
}));

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-20T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const routes = {
  user: () => import('@/app/api/user/api-tokens/route'),
  admin: () => import('@/app/api/admin/api-tokens/route'),
} as const;

let settingValue: string | null;

async function create(route: keyof typeof routes, body: Record<string, unknown>) {
  request.payload = body;
  const { POST } = await routes[route]();
  const response = await POST(request as never);
  return { status: response.status, body: await response.json() };
}

const stored = () => prismaMock.apiToken.create.mock.calls[0]?.[0]?.data;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  request.user.role = 'admin';
  settingValue = 'true';
  prismaMock.user.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === ADMIN_ID
      ? { id: ADMIN_ID, role: 'admin', plexUsername: 'admin', registrationStatus: 'approved' }
      : { id: OTHER_ID, role: 'admin', plexUsername: 'other', registrationStatus: 'approved' }
  );
  prismaMock.apiToken.count.mockResolvedValue(0);
  prismaMock.apiToken.create.mockImplementation(async ({ data }: any) => ({ id: 'tok-new', createdAt: new Date(), ...data }));
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: any) =>
    where.key === 'api_tokens.allow_request_approval' && settingValue !== null ? { key: where.key, value: settingValue } : null
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(['user', 'admin'] as const)('POST /api/%s/api-tokens with canApproveRequests', (route) => {
  it('an admin, setting on, 90 days: 201 with the flag and the expiry stored', async () => {
    const result = await create(route, { name: 'Approver', canApproveRequests: true, expiresAt: iso(NOW + 90 * DAY) });

    expect(result.status).toBe(201);
    expect(result.body.token).toMatchObject({ canApproveRequests: true });
    expect(stored()).toMatchObject({ canApproveRequests: true, expiresAt: new Date(NOW + 90 * DAY), userId: ADMIN_ID });
  });

  it.each([
    ['missing', {}],
    ['null', { expiresAt: null }],
    ['in the past', { expiresAt: iso(NOW - 1000) }],
    ['now', { expiresAt: iso(NOW) }],
    ['92 days away', { expiresAt: iso(NOW + 92 * DAY) }],
    ['1 year away', { expiresAt: iso(NOW + 365 * DAY) }],
  ])('expiry %s: 400 and nothing created', async (_label, expiry) => {
    const result = await create(route, { name: 'Approver', canApproveRequests: true, ...expiry });

    expect(result).toEqual({ status: 400, body: { error: 'A token that approves requests must expire within 90 days.' } });
    expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
  });

  it('90 days + 24 h is accepted and stored as exactly 90 days', async () => {
    const result = await create(route, { name: 'Approver', canApproveRequests: true, expiresAt: iso(NOW + 91 * DAY) });

    expect(result.status).toBe(201);
    expect(stored().expiresAt).toEqual(new Date(NOW + 90 * DAY));
  });

  it('just past 90 days + 24 h is refused', async () => {
    const result = await create(route, { name: 'Approver', canApproveRequests: true, expiresAt: iso(NOW + 91 * DAY + 1) });

    expect(result.status).toBe(400);
    expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
  });

  it('a local-date 90 days across a clock change (90 days + 1 h) is stored as 90 days', async () => {
    const result = await create(route, { name: 'Approver', canApproveRequests: true, expiresAt: iso(NOW + 90 * DAY + 60 * 60 * 1000) });

    expect(result.status).toBe(201);
    expect(stored().expiresAt).toEqual(new Date(NOW + 90 * DAY));
  });

  it('setting off: 403, even with a bad expiry (the permission is checked first)', async () => {
    settingValue = 'false';
    const result = await create(route, { name: 'Approver', canApproveRequests: true, expiresAt: iso(NOW + 365 * DAY) });

    expect(result).toEqual({ status: 403, body: { error: 'Turn on "Allow API tokens to approve requests" in Settings → API first.' } });
    expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
  });

  it('the expiry is checked before the token cap', async () => {
    prismaMock.apiToken.count.mockResolvedValue(25);
    expect((await create(route, { name: 'Approver', canApproveRequests: true })).status).toBe(400);
    expect((await create(route, { name: 'Approver', canApproveRequests: true, expiresAt: iso(NOW + 30 * DAY) })).status).toBe(403);
  });

  it('without the flag nothing changes: a never-expiring token is still created, unflagged', async () => {
    settingValue = null;
    const result = await create(route, { name: 'Plain', expiresAt: null });

    expect(result.status).toBe(201);
    expect(stored()).toMatchObject({ canApproveRequests: false, expiresAt: null });
    expect(prismaMock.configuration.findUnique).not.toHaveBeenCalled();
  });

  it('canApproveRequests false is the same as leaving it out', async () => {
    const result = await create(route, { name: 'Plain', canApproveRequests: false, expiresAt: iso(NOW + 365 * DAY) });

    expect(result.status).toBe(201);
    expect(stored()).toMatchObject({ canApproveRequests: false, expiresAt: new Date(NOW + 365 * DAY) });
  });

  it('a non-boolean flag is a validation error', async () => {
    expect((await create(route, { name: 'Approver', canApproveRequests: 'yes', expiresAt: iso(NOW + DAY) })).status).toBe(400);
  });
});

describe('who may create an approval token', () => {
  it('a non-admin on the user route: 403', async () => {
    request.user.role = 'user';
    prismaMock.user.findUnique.mockResolvedValue({ id: ADMIN_ID, role: 'user' });
    const result = await create('user', { name: 'Approver', canApproveRequests: true, expiresAt: iso(NOW + 30 * DAY) });

    expect(result).toEqual({ status: 403, body: { error: 'Only an admin can create a token that approves requests.' } });
    expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
  });

  it('the user route reads the role from the database, not the session', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: ADMIN_ID, role: 'user' });
    expect((await create('user', { name: 'Approver', canApproveRequests: true, expiresAt: iso(NOW + 30 * DAY) })).status).toBe(403);
  });

  it('the admin route refuses a token for another user, even another admin: 403', async () => {
    const result = await create('admin', { name: 'Approver', canApproveRequests: true, userId: OTHER_ID, expiresAt: iso(NOW + 30 * DAY) });

    expect(result).toEqual({ status: 403, body: { error: 'A token that approves requests can only be created for your own account.' } });
    expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
  });

  it('the admin route accepts the admin\'s own id as userId', async () => {
    const result = await create('admin', { name: 'Approver', canApproveRequests: true, userId: ADMIN_ID, expiresAt: iso(NOW + 30 * DAY) });
    expect(result.status).toBe(201);
    expect(stored()).toMatchObject({ canApproveRequests: true, userId: ADMIN_ID });
  });
});

describe('GET token lists', () => {
  const rows = [
    { id: 't1', name: 'A', tokenPrefix: 'rmab_a', role: 'admin', lastUsedAt: null, expiresAt: null, createdAt: new Date(), canApproveRequests: true, createdBy: { id: ADMIN_ID, plexUsername: 'admin' }, tokenUser: { id: ADMIN_ID, plexUsername: 'admin', role: 'admin' } },
    { id: 't2', name: 'B', tokenPrefix: 'rmab_b', role: 'admin', lastUsedAt: null, expiresAt: null, createdAt: new Date(), canApproveRequests: false, createdBy: { id: ADMIN_ID, plexUsername: 'admin' }, tokenUser: { id: ADMIN_ID, plexUsername: 'admin', role: 'admin' } },
  ];

  it.each(['user', 'admin'] as const)('%s: each token carries canApproveRequests; approvals available while the setting is on', async (route) => {
    prismaMock.apiToken.findMany.mockResolvedValue(rows);
    const { GET } = await routes[route]();
    const body = await (await GET(request as never)).json();

    expect(body.tokens.map((t: any) => t.canApproveRequests)).toEqual([true, false]);
    expect(body.approvalTokensAvailable).toBe(true);

    settingValue = 'false';
    expect((await (await GET(request as never)).json()).approvalTokensAvailable).toBe(false);
  });

  it('user route: a non-admin never sees approvals available', async () => {
    request.user.role = 'user';
    prismaMock.apiToken.findMany.mockResolvedValue([]);
    const { GET } = await routes.user();
    expect((await (await GET(request as never)).json()).approvalTokensAvailable).toBe(false);
  });

  it('a failed setting read lists the tokens with approvals unavailable', async () => {
    prismaMock.apiToken.findMany.mockResolvedValue(rows);
    prismaMock.configuration.findUnique.mockRejectedValue(new Error('down'));
    const { GET } = await routes.admin();
    const response = await GET(request as never);

    expect(response.status).toBe(200);
    expect((await response.json()).approvalTokensAvailable).toBe(false);
  });
});
