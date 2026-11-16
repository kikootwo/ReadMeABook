/**
 * Component: Admin API Token Settings Route Tests (allow API tokens to approve requests)
 * Documentation: documentation/backend/services/api-tokens.md
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const state = vi.hoisted(() => ({ role: 'admin', payload: undefined as unknown }));
const request = vi.hoisted(() => ({ json: async () => state.payload }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) =>
    handler({ ...request, user: { id: 'admin-1', sub: 'admin-1', role: state.role } }),
  requireAdmin: (req: any, handler: () => unknown) =>
    req.user.role === 'admin' ? handler() : NextResponse.json({ error: 'Forbidden', message: 'Admin access required' }, { status: 403 }),
}));

const KEY = 'api_tokens.allow_request_approval';
const load = () => import('@/app/api/admin/settings/api-tokens/route');

describe('/api/admin/settings/api-tokens', () => {
  beforeEach(() => {
    state.role = 'admin';
    state.payload = undefined;
    prismaMock.configuration.upsert.mockResolvedValue({});
  });

  it('GET defaults to false when the row is missing', async () => {
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    const { GET } = await load();
    const response = await GET(request as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ allowRequestApproval: false });
    expect(prismaMock.configuration.findUnique).toHaveBeenCalledWith({ where: { key: KEY } });
  });

  it.each([['true', true], ['false', false], ['TRUE', false]])('GET reads the row value %s as %s', async (value, expected) => {
    prismaMock.configuration.findUnique.mockResolvedValue({ key: KEY, value });
    const { GET } = await load();
    expect(await (await GET(request as never)).json()).toEqual({ allowRequestApproval: expected });
  });

  it.each([[true, 'true'], [false, 'false']])('PATCH %s upserts %s', async (on, stored) => {
    state.payload = { allowRequestApproval: on };
    const { PATCH } = await load();
    const response = await PATCH(request as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ allowRequestApproval: on });
    expect(prismaMock.configuration.upsert).toHaveBeenCalledWith({
      where: { key: KEY },
      create: { key: KEY, value: stored },
      update: { value: stored },
    });
  });

  it.each([[{ allowRequestApproval: 'true' }], [{ allowRequestApproval: 1 }], [{}], [null]])('PATCH %j is 400 and stores nothing', async (payload) => {
    state.payload = payload;
    const { PATCH } = await load();
    const response = await PATCH(request as never);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('allowRequestApproval must be true or false');
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
  });

  it('a non-admin gets 403 on GET and PATCH and nothing is stored', async () => {
    state.role = 'user';
    state.payload = { allowRequestApproval: true };
    const { GET, PATCH } = await load();

    expect((await GET(request as never)).status).toBe(403);
    expect((await PATCH(request as never)).status).toBe(403);
    expect(prismaMock.configuration.upsert).not.toHaveBeenCalled();
  });
});
