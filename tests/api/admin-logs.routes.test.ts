/**
 * Component: Admin Logs API Route Tests
 * Documentation: documentation/testing.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

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

async function callRoute(query: string = '') {
  prismaMock.job.findMany.mockResolvedValueOnce([]);
  prismaMock.job.count.mockResolvedValueOnce(0);
  const { GET } = await import('@/app/api/admin/logs/route');
  const url = `http://localhost/api/admin/logs${query ? `?${query}` : ''}`;
  const response = await GET({ url } as any);
  const payload = await response.json();
  const findManyArgs = prismaMock.job.findMany.mock.calls[0][0];
  const countArgs = prismaMock.job.count.mock.calls[0][0];
  return { response, payload, findManyArgs, countArgs };
}

describe('Admin logs route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'admin-1', role: 'admin' } };
    requireAuthMock.mockImplementation((_req: any, handler: any) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: any, handler: any) => handler());
  });

  it('returns paginated logs', async () => {
    prismaMock.job.findMany.mockResolvedValueOnce([{ id: 'job-1' }]);
    prismaMock.job.count.mockResolvedValueOnce(1);

    const { GET } = await import('@/app/api/admin/logs/route');
    const response = await GET({ url: 'http://localhost/api/admin/logs?page=1&limit=25' } as any);
    const payload = await response.json();

    expect(payload.logs).toHaveLength(1);
    expect(payload.pagination.total).toBe(1);
  });

  describe('where composition', () => {
    it('builds empty where when no filters provided', async () => {
      const { findManyArgs } = await callRoute();
      expect(findManyArgs.where).toEqual({});
    });

    it('applies status filter only when not "all"', async () => {
      const { findManyArgs } = await callRoute('status=failed');
      expect(findManyArgs.where).toEqual({ status: 'failed' });
    });

    it('skips status when value is "all"', async () => {
      const { findManyArgs } = await callRoute('status=all');
      expect(findManyArgs.where).toEqual({});
    });

    it('applies type filter only when not "all"', async () => {
      const { findManyArgs } = await callRoute('type=scan_plex');
      expect(findManyArgs.where).toEqual({ type: 'scan_plex' });
    });

    it('applies dateFrom and dateTo as createdAt range', async () => {
      const { findManyArgs } = await callRoute(
        'dateFrom=2026-01-01T00:00:00.000Z&dateTo=2026-02-01T00:00:00.000Z'
      );
      expect(findManyArgs.where.createdAt).toEqual({
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lte: new Date('2026-02-01T00:00:00.000Z'),
      });
    });

    it('silently drops invalid date strings', async () => {
      const { findManyArgs } = await callRoute('dateFrom=not-a-date&dateTo=also-not-a-date');
      expect(findManyArgs.where.createdAt).toBeUndefined();
    });

    it('applies hasError=true as OR of failed/stuck status or non-null errorMessage', async () => {
      const { findManyArgs } = await callRoute('hasError=true');
      expect(findManyArgs.where.OR).toEqual([
        { status: { in: ['failed', 'stuck'] } },
        { errorMessage: { not: null } },
      ]);
    });

    it('also accepts hasError=1 as truthy', async () => {
      const { findManyArgs } = await callRoute('hasError=1');
      expect(findManyArgs.where.OR).toEqual([
        { status: { in: ['failed', 'stuck'] } },
        { errorMessage: { not: null } },
      ]);
    });

    it('treats hasError=false as no errors filter', async () => {
      const { findManyArgs } = await callRoute('hasError=false');
      expect(findManyArgs.where.OR).toBeUndefined();
    });

    it('applies userId filter via request.is.userId', async () => {
      const { findManyArgs } = await callRoute('userId=user-abc-123');
      expect(findManyArgs.where.request).toEqual({ is: { userId: 'user-abc-123' } });
    });

    it('applies audiobookQuery as OR-contains on audiobook title/author', async () => {
      const { findManyArgs } = await callRoute('audiobookQuery=Sanderson');
      expect(findManyArgs.where.request).toEqual({
        is: {
          audiobook: {
            is: {
              OR: [
                { title: { contains: 'Sanderson', mode: 'insensitive' } },
                { author: { contains: 'Sanderson', mode: 'insensitive' } },
              ],
            },
          },
        },
      });
    });

    it('search applies six-column OR with bullJobId startsWith (case-sensitive)', async () => {
      const { findManyArgs } = await callRoute('search=abc123');
      const or = findManyArgs.where.OR;
      expect(Array.isArray(or)).toBe(true);
      expect(or).toHaveLength(6);
      expect(or[0]).toEqual({ bullJobId: { startsWith: 'abc123' } });
      expect(or[1]).toEqual({ errorMessage: { contains: 'abc123', mode: 'insensitive' } });
    });

    it('search includes events.some.message clause for event-text search', async () => {
      const { findManyArgs } = await callRoute('search=timeout');
      const hasEventClause = findManyArgs.where.OR.some(
        (clause: any) =>
          clause.events?.some?.message?.contains === 'timeout' &&
          clause.events?.some?.message?.mode === 'insensitive'
      );
      expect(hasEventClause).toBe(true);
    });

    it('search includes audiobook title/author and plexUsername clauses', async () => {
      const { findManyArgs } = await callRoute('search=foo');
      const or = findManyArgs.where.OR;
      const findRequestClause = (path: (clause: any) => any) =>
        or.find((clause: any) => path(clause) === 'foo');
      expect(findRequestClause((c: any) => c.request?.is?.audiobook?.is?.title?.contains)).toBeTruthy();
      expect(findRequestClause((c: any) => c.request?.is?.audiobook?.is?.author?.contains)).toBeTruthy();
      expect(findRequestClause((c: any) => c.request?.is?.user?.is?.plexUsername?.contains)).toBeTruthy();
    });

    it('treats whitespace-only search as no search', async () => {
      const { findManyArgs } = await callRoute('search=%20%20%20');
      expect(findManyArgs.where.OR).toBeUndefined();
    });

    it('treats whitespace-only audiobookQuery as no filter', async () => {
      const { findManyArgs } = await callRoute('audiobookQuery=%20');
      expect(findManyArgs.where.request).toBeUndefined();
    });

    it('combines hasError and search under top-level AND wrapper', async () => {
      const { findManyArgs } = await callRoute('hasError=true&search=oom');
      expect(findManyArgs.where.AND).toBeDefined();
      expect(findManyArgs.where.AND).toHaveLength(2);
      expect(findManyArgs.where.OR).toBeUndefined();
      const orClauses = findManyArgs.where.AND.map((c: any) => c.OR);
      expect(orClauses[0]).toEqual([
        { status: { in: ['failed', 'stuck'] } },
        { errorMessage: { not: null } },
      ]);
      expect(Array.isArray(orClauses[1])).toBe(true);
      expect(orClauses[1]).toHaveLength(6);
    });

    it('combines all filters together', async () => {
      const { findManyArgs } = await callRoute(
        'status=failed&type=scan_plex&dateFrom=2026-01-01T00:00:00.000Z&dateTo=2026-02-01T00:00:00.000Z&userId=user-1&audiobookQuery=Way%20of%20Kings&hasError=true&search=disk'
      );
      const where = findManyArgs.where;
      expect(where.status).toBe('failed');
      expect(where.type).toBe('scan_plex');
      expect(where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00.000Z'));
      expect(where.createdAt.lte).toEqual(new Date('2026-02-01T00:00:00.000Z'));
      expect(where.request.is.userId).toBe('user-1');
      expect(where.request.is.audiobook.is.OR).toHaveLength(2);
      expect(where.AND).toHaveLength(2);
    });

    it('uses identical where for findMany and count', async () => {
      const { findManyArgs, countArgs } = await callRoute('status=failed&hasError=true');
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
        const { findManyArgs, payload } = await callRoute(query);
        expect(findManyArgs.take).toBe(expected);
        expect(payload.pagination.limit).toBe(expected);
      });
    }
  });

  describe('pagination math', () => {
    it('page=2 with limit=50 and total=75 returns totalPages=2 and skip=50', async () => {
      prismaMock.job.findMany.mockResolvedValueOnce([]);
      prismaMock.job.count.mockResolvedValueOnce(75);
      const { GET } = await import('@/app/api/admin/logs/route');
      const response = await GET({
        url: 'http://localhost/api/admin/logs?page=2&limit=50',
      } as any);
      const payload = await response.json();
      const findManyArgs = prismaMock.job.findMany.mock.calls[0][0];

      expect(findManyArgs.skip).toBe(50);
      expect(findManyArgs.take).toBe(50);
      expect(payload.pagination.page).toBe(2);
      expect(payload.pagination.limit).toBe(50);
      expect(payload.pagination.total).toBe(75);
      expect(payload.pagination.totalPages).toBe(2);
    });

    it('coerces invalid page to 1', async () => {
      const { findManyArgs, payload } = await callRoute('page=-3');
      expect(findManyArgs.skip).toBe(0);
      expect(payload.pagination.page).toBe(1);
    });
  });
});
