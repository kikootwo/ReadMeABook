/**
 * Component: Approval API Token Creation + Setting Route Tests
 * Documentation: documentation/backend/services/api-tokens.md
 *
 * "Can approve requests" is set only at creation, only by an admin for their own account, and only
 * while the admin setting is on. The setting route stores a strict boolean.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '22222222-2222-2222-2222-222222222222';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({ requireAuth: requireAuthMock, requireAdmin: requireAdminMock }));
vi.mock('@/lib/utils/rateLimit', () => ({ checkApiTokenCreateRateLimit: () => ({ allowed: true }) }));
vi.mock('@/lib/utils/api-token', () => ({
  generateApiToken: () => ({ fullToken: 'rmab_full', tokenHash: 'hash', tokenPrefix: 'rmab_prefix' }),
}));

const givenSetting = (on: boolean) =>
  prismaMock.configuration.findUnique.mockResolvedValue({ key: 'api_tokens.allow_request_approval', value: String(on) });

function as(id: string, role: 'admin' | 'user', body: Record<string, unknown> = {}) {
  authRequest = { user: { id, sub: id, username: id, role }, json: vi.fn().mockResolvedValue(body) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
  requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  prismaMock.apiToken.count.mockResolvedValue(0);
  prismaMock.apiToken.findMany.mockResolvedValue([]);
  prismaMock.apiToken.create.mockImplementation(async ({ data }: any) => ({ id: 'token-1', createdAt: new Date(), ...data }));
});

describe('POST /api/admin/api-tokens with canApproveRequests', () => {
  const post = async () => {
    const { POST } = await import('@/app/api/admin/api-tokens/route');
    const response = await POST({} as any);
    return { status: response.status, body: await response.json() };
  };

  it("creates the admin's own approval token, keeping the expiry it was given", async () => {
    givenSetting(true);
    as(ADMIN_ID, 'admin', { name: 'Absorb', canApproveRequests: true, expiresAt: null });
    prismaMock.user.findUnique.mockResolvedValue({ id: ADMIN_ID, role: 'admin', plexUsername: 'boss' });

    const res = await post();

    expect(res.status).toBe(201);
    expect(res.body.token.canApproveRequests).toBe(true);
    expect(prismaMock.apiToken.create.mock.calls[0][0].data).toMatchObject({ canApproveRequests: true, expiresAt: null });
  });

  it("refuses one for another admin's account", async () => {
    givenSetting(true);
    as(ADMIN_ID, 'admin', { name: 'Absorb', userId: OTHER_ADMIN_ID, canApproveRequests: true });
    prismaMock.user.findUnique.mockResolvedValue({ id: OTHER_ADMIN_ID, role: 'admin', plexUsername: 'other' });

    const res = await post();

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/your own account/);
    expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
  });

  it("refuses one for a user's account", async () => {
    givenSetting(true);
    as(ADMIN_ID, 'admin', { name: 'Absorb', userId: USER_ID, canApproveRequests: true });
    prismaMock.user.findUnique.mockResolvedValue({ id: USER_ID, role: 'user', plexUsername: 'reader' });

    expect((await post()).status).toBe(403);
    expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
  });

  it('refuses one while the setting is off', async () => {
    givenSetting(false);
    as(ADMIN_ID, 'admin', { name: 'Absorb', canApproveRequests: true });
    prismaMock.user.findUnique.mockResolvedValue({ id: ADMIN_ID, role: 'admin', plexUsername: 'boss' });

    const res = await post();

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Settings → API/);
  });

  it('creates ordinary tokens without the permission, setting off or on', async () => {
    givenSetting(false);
    as(ADMIN_ID, 'admin', { name: 'Plain', userId: USER_ID });
    prismaMock.user.findUnique.mockResolvedValue({ id: USER_ID, role: 'user', plexUsername: 'reader' });

    const res = await post();

    expect(res.status).toBe(201);
    expect(prismaMock.apiToken.create.mock.calls[0][0].data.canApproveRequests).toBe(false);
  });

  it('GET reports whether the form may offer the option', async () => {
    as(ADMIN_ID, 'admin');
    const { GET } = await import('@/app/api/admin/api-tokens/route');

    givenSetting(true);
    expect((await (await GET({} as any)).json()).approvalTokensAvailable).toBe(true);
    givenSetting(false);
    expect((await (await GET({} as any)).json()).approvalTokensAvailable).toBe(false);
  });
});

describe('POST /api/user/api-tokens with canApproveRequests', () => {
  const post = async () => {
    const { POST } = await import('@/app/api/user/api-tokens/route');
    const response = await POST({} as any);
    return { status: response.status, body: await response.json() };
  };

  it('lets an admin create their own approval token', async () => {
    givenSetting(true);
    as(ADMIN_ID, 'admin', { name: 'Absorb', canApproveRequests: true });
    prismaMock.user.findUnique.mockResolvedValue({ role: 'admin' });

    const res = await post();

    expect(res.status).toBe(201);
    expect(res.body.token.canApproveRequests).toBe(true);
  });

  it('refuses a non-admin', async () => {
    givenSetting(true);
    as(USER_ID, 'user', { name: 'Absorb', canApproveRequests: true });
    prismaMock.user.findUnique.mockResolvedValue({ role: 'user' });

    const res = await post();

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Only admins/);
    expect(prismaMock.apiToken.create).not.toHaveBeenCalled();
  });

  it('GET offers the option to admins only, and only while the setting is on', async () => {
    const { GET } = await import('@/app/api/user/api-tokens/route');
    givenSetting(true);

    as(ADMIN_ID, 'admin');
    expect((await (await GET({} as any)).json()).approvalTokensAvailable).toBe(true);
    as(USER_ID, 'user');
    expect((await (await GET({} as any)).json()).approvalTokensAvailable).toBe(false);
    as(ADMIN_ID, 'admin');
    givenSetting(false);
    expect((await (await GET({} as any)).json()).approvalTokensAvailable).toBe(false);
  });
});

describe('/api/admin/settings/api-tokens', () => {
  it('GET is off when the key was never saved', async () => {
    as(ADMIN_ID, 'admin');
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    const { GET } = await import('@/app/api/admin/settings/api-tokens/route');

    expect(await (await GET({} as any)).json()).toEqual({ allowRequestApproval: false });
  });

  it('PATCH stores a boolean', async () => {
    as(ADMIN_ID, 'admin');
    const { PATCH } = await import('@/app/api/admin/settings/api-tokens/route');

    const response = await PATCH({ json: vi.fn().mockResolvedValue({ allowRequestApproval: true }) } as any);

    expect(response.status).toBe(200);
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith({
      where: { key: 'api_tokens.allow_request_approval' },
      create: { key: 'api_tokens.allow_request_approval', value: 'true' },
      update: { value: 'true' },
    });
  });

  it.each(['true', 1, null])('PATCH refuses a non-boolean (%s)', async (value) => {
    as(ADMIN_ID, 'admin');
    const { PATCH } = await import('@/app/api/admin/settings/api-tokens/route');

    const response = await PATCH({ json: vi.fn().mockResolvedValue({ allowRequestApproval: value }) } as any);

    expect(response.status).toBe(400);
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
  });
});
