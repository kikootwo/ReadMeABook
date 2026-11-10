/**
 * Component: Selected-download display reads take the newest row (#332)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * A request that moved on after a download-client failure keeps the failed attempts as selected
 * rows. The display reads that take one selected row must take the newest, not an arbitrary one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({ requireAuth: requireAuthMock, requireAdmin: requireAdminMock }));

const NEWEST_FIRST = { createdAt: 'desc' };

describe('one selected download per request: the newest (#332)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockImplementation((_req: unknown, handler: (r: unknown) => unknown) => handler({ user: { id: 'admin-1', role: 'admin' } }));
    requireAdminMock.mockImplementation((_req: unknown, handler: () => unknown) => handler());
    prismaMock.request.findMany.mockResolvedValue([]);
    prismaMock.request.count.mockResolvedValue(0);
  });

  it('GET /api/requests/[id] (admin and owner shapes)', async () => {
    const { ADMIN_REQUEST_DETAIL_INCLUDE, OWNER_REQUEST_DETAIL_SELECT } = await import('@/lib/services/request-detail-query');

    expect(ADMIN_REQUEST_DETAIL_INCLUDE.downloadHistory).toMatchObject({ take: 1, orderBy: NEWEST_FIRST });
    expect(OWNER_REQUEST_DETAIL_SELECT.downloadHistory).toMatchObject({ take: 1, orderBy: NEWEST_FIRST });
  });

  it.each([
    ['GET /api/admin/requests', '@/app/api/admin/requests/route', 'http://localhost/api/admin/requests'],
    ['GET /api/admin/requests/recent', '@/app/api/admin/requests/recent/route', 'http://localhost/api/admin/requests/recent'],
  ])('%s', async (_name, modulePath, url) => {
    const { GET } = await import(modulePath);
    await GET({ url } as unknown as NextRequest);

    expect(prismaMock.request.findMany).toHaveBeenCalled();
    const downloadHistory = prismaMock.request.findMany.mock.calls[0][0].include.downloadHistory;
    expect(downloadHistory).toMatchObject({ where: { selected: true }, take: 1, orderBy: NEWEST_FIRST });
  });
});
