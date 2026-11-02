/**
 * Component: Admin Metrics API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { countUsersIn } from '../helpers/user-rows';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

describe('Admin metrics route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  it('returns metrics and system health', async () => {
    prismaMock.request.count
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    prismaMock.user.count.mockResolvedValueOnce(3);
    prismaMock.$queryRaw.mockResolvedValueOnce(1);

    const { GET } = await import('@/app/api/admin/metrics/route');
    const response = await GET({} as any);
    const payload = await response.json();

    expect(payload.totalRequests).toBe(10);
    expect(payload.systemHealth.status).toBe('healthy');
  });

  it('does not count soft-deleted users in totalUsers', async () => {
    prismaMock.request.count.mockResolvedValue(0);
    prismaMock.user.count.mockImplementation(countUsersIn([
      { id: 'u-admin', role: 'admin', deletedAt: null },
      { id: 'u-active', role: 'user', deletedAt: null },
      { id: 'u-gone-1', role: 'user', deletedAt: new Date('2026-01-01') },
      { id: 'u-gone-2', role: 'admin', deletedAt: new Date('2026-02-01') },
    ]));
    prismaMock.$queryRaw.mockResolvedValueOnce(1);

    const { GET } = await import('@/app/api/admin/metrics/route');
    const response = await GET({} as Parameters<typeof GET>[0]);
    const payload = await response.json();

    expect(payload.totalUsers).toBe(2);
  });
});


