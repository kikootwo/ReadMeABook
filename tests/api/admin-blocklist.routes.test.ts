/**
 * Component: Admin Blocklist API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: any;

const prismaMock = createPrismaMock();
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const clearBlocklistMock = vi.hoisted(() => vi.fn());
const removeBlockMock = vi.hoisted(() => vi.fn());
const getBlocklistForRequestMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: requireAuthMock,
  requireAdmin: requireAdminMock,
}));

vi.mock('@/lib/services/blocklist.service', () => ({
  clearBlocklist: clearBlocklistMock,
  removeBlock: removeBlockMock,
  getBlocklistForRequest: getBlocklistForRequestMock,
}));

async function callList(query: string = '') {
  prismaMock.blockedRelease.findMany.mockResolvedValueOnce([]);
  prismaMock.blockedRelease.count.mockResolvedValueOnce(0);
  const { GET } = await import('@/app/api/admin/blocklist/route');
  const url = `http://localhost/api/admin/blocklist${query ? `?${query}` : ''}`;
  const response = await GET({ url } as any);
  const payload = await response.json();
  const findManyArgs = prismaMock.blockedRelease.findMany.mock.calls[0][0];
  const countArgs = prismaMock.blockedRelease.count.mock.calls[0][0];
  return { response, payload, findManyArgs, countArgs };
}

async function callBulkDelete(query: string = '') {
  clearBlocklistMock.mockResolvedValueOnce({ count: 0 });
  const { DELETE } = await import('@/app/api/admin/blocklist/route');
  const url = `http://localhost/api/admin/blocklist${query ? `?${query}` : ''}`;
  const response = await DELETE({ url } as any);
  const payload = await response.json();
  const where = clearBlocklistMock.mock.calls[0]?.[0];
  return { response, payload, where };
}

describe('Admin blocklist list route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  it('returns paginated entries', async () => {
    prismaMock.blockedRelease.findMany.mockResolvedValueOnce([{ id: 'b1' }]);
    prismaMock.blockedRelease.count.mockResolvedValueOnce(1);

    const { GET } = await import('@/app/api/admin/blocklist/route');
    const response = await GET({ url: 'http://localhost/api/admin/blocklist?page=1&limit=25' } as any);
    const payload = await response.json();

    expect(payload.entries).toHaveLength(1);
    expect(payload.pagination.total).toBe(1);
  });

  describe('where composition', () => {
    it('builds empty where when no filters provided', async () => {
      const { findManyArgs } = await callList();
      expect(findManyArgs.where).toEqual({});
    });

    it('applies requestId filter', async () => {
      const { findManyArgs } = await callList('requestId=req-123');
      expect(findManyArgs.where).toEqual({ requestId: 'req-123' });
    });

    it('applies source filter when valid', async () => {
      const { findManyArgs } = await callList('source=organize_fail');
      expect(findManyArgs.where).toEqual({ source: 'organize_fail' });
    });

    it('drops source filter when invalid', async () => {
      const { findManyArgs } = await callList('source=bogus');
      expect(findManyArgs.where).toEqual({});
    });

    it('drops source filter when "all"', async () => {
      const { findManyArgs } = await callList('source=all');
      expect(findManyArgs.where).toEqual({});
    });

    it('applies dateFrom and dateTo as createdAt range', async () => {
      const { findManyArgs } = await callList(
        'dateFrom=2026-01-01T00:00:00.000Z&dateTo=2026-02-01T00:00:00.000Z'
      );
      expect(findManyArgs.where.createdAt).toEqual({
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lte: new Date('2026-02-01T00:00:00.000Z'),
      });
    });

    it('silently drops invalid date strings', async () => {
      const { findManyArgs } = await callList('dateFrom=not-a-date&dateTo=also-not-a-date');
      expect(findManyArgs.where.createdAt).toBeUndefined();
    });

    it('applies search as case-insensitive OR over releaseName + reason', async () => {
      const { findManyArgs } = await callList('search=epub');
      expect(findManyArgs.where.OR).toEqual([
        { releaseName: { contains: 'epub', mode: 'insensitive' } },
        { reason: { contains: 'epub', mode: 'insensitive' } },
      ]);
    });

    it('treats whitespace-only search as no search', async () => {
      const { findManyArgs } = await callList('search=%20%20%20');
      expect(findManyArgs.where.OR).toBeUndefined();
    });

    it('treats whitespace-only requestId as no filter', async () => {
      const { findManyArgs } = await callList('requestId=%20');
      expect(findManyArgs.where.requestId).toBeUndefined();
    });

    it('combines all filters together', async () => {
      const { findManyArgs } = await callList(
        'requestId=r-1&source=download_fail&dateFrom=2026-01-01T00:00:00.000Z&dateTo=2026-02-01T00:00:00.000Z&search=par2'
      );
      const where = findManyArgs.where;
      expect(where.requestId).toBe('r-1');
      expect(where.source).toBe('download_fail');
      expect(where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(where.createdAt.lte).toEqual(new Date('2026-02-01T00:00:00.000Z'));
      expect(where.OR).toEqual([
        { releaseName: { contains: 'par2', mode: 'insensitive' } },
        { reason: { contains: 'par2', mode: 'insensitive' } },
      ]);
    });

    it('uses identical where for findMany and count', async () => {
      const { findManyArgs, countArgs } = await callList('source=download_fail&search=par2');
      expect(countArgs.where).toEqual(findManyArgs.where);
    });
  });

  describe('limit clamp', () => {
    const cases: Array<[string | null, number]> = [
      ['25', 25],
      ['50', 50],
      ['100', 100],
      ['24', 50],
      ['75', 50],
      ['101', 50],
      ['abc', 50],
      [null, 50],
    ];

    for (const [raw, expected] of cases) {
      it(`limit=${raw} → take ${expected}`, async () => {
        const query = raw === null ? '' : `limit=${raw}`;
        const { findManyArgs, payload } = await callList(query);
        expect(findManyArgs.take).toBe(expected);
        expect(payload.pagination.limit).toBe(expected);
      });
    }
  });

  describe('sort', () => {
    it('defaults to createdAt desc', async () => {
      const { findManyArgs } = await callList();
      expect(findManyArgs.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('applies sortBy=releaseName sortOrder=asc', async () => {
      const { findManyArgs } = await callList('sortBy=releaseName&sortOrder=asc');
      expect(findManyArgs.orderBy).toEqual({ releaseName: 'asc' });
    });

    it('falls back to createdAt for unknown sortBy', async () => {
      const { findManyArgs } = await callList('sortBy=bogus');
      expect(findManyArgs.orderBy).toEqual({ createdAt: 'desc' });
    });

    it('falls back to desc for unknown sortOrder', async () => {
      const { findManyArgs } = await callList('sortBy=reason&sortOrder=sideways');
      expect(findManyArgs.orderBy).toEqual({ reason: 'desc' });
    });
  });

  describe('pagination math', () => {
    it('page=2 with limit=50 and total=75 returns totalPages=2 and skip=50', async () => {
      prismaMock.blockedRelease.findMany.mockResolvedValueOnce([]);
      prismaMock.blockedRelease.count.mockResolvedValueOnce(75);
      const { GET } = await import('@/app/api/admin/blocklist/route');
      const response = await GET({
        url: 'http://localhost/api/admin/blocklist?page=2&limit=50',
      } as any);
      const payload = await response.json();
      const findManyArgs = prismaMock.blockedRelease.findMany.mock.calls[0][0];

      expect(findManyArgs.skip).toBe(50);
      expect(findManyArgs.take).toBe(50);
      expect(payload.pagination.page).toBe(2);
      expect(payload.pagination.limit).toBe(50);
      expect(payload.pagination.total).toBe(75);
      expect(payload.pagination.totalPages).toBe(2);
    });

    it('coerces invalid page to 1', async () => {
      const { findManyArgs, payload } = await callList('page=-3');
      expect(findManyArgs.skip).toBe(0);
      expect(payload.pagination.page).toBe(1);
    });

    it('totalPages is at least 1 when total is 0', async () => {
      const { payload } = await callList();
      expect(payload.pagination.totalPages).toBe(1);
    });
  });
});

describe('Admin blocklist bulk-clear DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  it('returns count from clearBlocklist', async () => {
    clearBlocklistMock.mockResolvedValueOnce({ count: 7 });
    const { DELETE } = await import('@/app/api/admin/blocklist/route');
    const response = await DELETE({ url: 'http://localhost/api/admin/blocklist' } as any);
    const payload = await response.json();
    expect(payload).toEqual({ count: 7 });
  });

  it('passes filter-scoped where to clearBlocklist', async () => {
    const { where } = await callBulkDelete('source=organize_fail&requestId=r-1');
    expect(where).toEqual({ requestId: 'r-1', source: 'organize_fail' });
  });

  it('passes empty where when no filters given (admin UI gates with typed token)', async () => {
    const { where } = await callBulkDelete();
    expect(where).toEqual({});
  });

  it('returns 500 when clearBlocklist throws', async () => {
    clearBlocklistMock.mockRejectedValueOnce(new Error('db down'));
    const { DELETE } = await import('@/app/api/admin/blocklist/route');
    const response = await DELETE({ url: 'http://localhost/api/admin/blocklist' } as any);
    expect(response.status).toBe(500);
  });
});

describe('Admin blocklist single-unblock DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  it('calls removeBlock with the route param id', async () => {
    removeBlockMock.mockResolvedValueOnce(undefined);
    const { DELETE } = await import('@/app/api/admin/blocklist/[id]/route');
    const response = await DELETE(
      { url: 'http://localhost/api/admin/blocklist/abc-123' } as any,
      { params: Promise.resolve({ id: 'abc-123' }) }
    );
    expect(removeBlockMock).toHaveBeenCalledWith('abc-123');
    const payload = await response.json();
    expect(payload).toEqual({ success: true });
  });

  it('rejects whitespace-only id with 400', async () => {
    const { DELETE } = await import('@/app/api/admin/blocklist/[id]/route');
    const response = await DELETE(
      { url: 'http://localhost/api/admin/blocklist/' } as any,
      { params: Promise.resolve({ id: '   ' }) }
    );
    expect(response.status).toBe(400);
    expect(removeBlockMock).not.toHaveBeenCalled();
  });

  it('maps Prisma P2025 to 404 NotFound', async () => {
    const { Prisma } = await import('@/generated/prisma');
    const notFound = new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: 'test',
    });
    removeBlockMock.mockRejectedValueOnce(notFound);
    const { DELETE } = await import('@/app/api/admin/blocklist/[id]/route');
    const response = await DELETE(
      { url: 'http://localhost/api/admin/blocklist/missing' } as any,
      { params: Promise.resolve({ id: 'missing' }) }
    );
    expect(response.status).toBe(404);
  });

  it('maps unknown errors to 500', async () => {
    removeBlockMock.mockRejectedValueOnce(new Error('boom'));
    const { DELETE } = await import('@/app/api/admin/blocklist/[id]/route');
    const response = await DELETE(
      { url: 'http://localhost/api/admin/blocklist/some-id' } as any,
      { params: Promise.resolve({ id: 'some-id' }) }
    );
    expect(response.status).toBe(500);
  });
});

describe('Admin blocklist by-request GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  it('returns entries + count for the request', async () => {
    const rows = [
      { id: 'b1', releaseName: 'Foo' },
      { id: 'b2', releaseName: 'Bar' },
    ];
    getBlocklistForRequestMock.mockResolvedValueOnce(rows);
    const { GET } = await import('@/app/api/admin/blocklist/by-request/[requestId]/route');
    const response = await GET(
      { url: 'http://localhost/api/admin/blocklist/by-request/r-1' } as any,
      { params: Promise.resolve({ requestId: 'r-1' }) }
    );
    const payload = await response.json();
    expect(getBlocklistForRequestMock).toHaveBeenCalledWith('r-1');
    expect(payload).toEqual({ entries: rows, count: 2 });
  });

  it('rejects whitespace-only requestId with 400', async () => {
    const { GET } = await import('@/app/api/admin/blocklist/by-request/[requestId]/route');
    const response = await GET(
      { url: 'http://localhost/api/admin/blocklist/by-request/' } as any,
      { params: Promise.resolve({ requestId: '  ' }) }
    );
    expect(response.status).toBe(400);
    expect(getBlocklistForRequestMock).not.toHaveBeenCalled();
  });
});
