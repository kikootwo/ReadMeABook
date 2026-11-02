/**
 * Component: Request lists and detail show the library's edition of a followed request (#325a)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * GET /api/requests, GET /api/admin/requests and GET /api/requests/:id: a followed audiobook
 * request shows the linked item's title, author and cover; `audibleAsin` (and the admin `asin`,
 * which View details uses) stays the requested ASIN; `libraryAsin` is the effective value (null
 * when the overlay does not apply). The admin text filter also matches the library title.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

type Handler = (req?: unknown) => unknown;
let authRequest: { user: { id: string; role: string }; nextUrl: URL };
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({ requireAuth: requireAuthMock, requireAdmin: requireAdminMock }));
vi.mock('@/lib/services/download-selection-guard', () => ({ stripProwlarrKeyFromResults: async (r: unknown) => r }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => ({ addSearchJob: vi.fn(), addNotificationJob: vi.fn() }) }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn() }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => ({ getAudiobookDetails: vi.fn() }) }));

const X = 'B082BHJMFF';
const Y = 'B072R1CY4P';
const BOOK = {
  id: 'ab-1', audibleAsin: X, libraryAsin: Y, absItemId: 'abs-1', plexGuid: null, filePath: '/media/a/b',
  title: 'The Martian', author: 'Andy Weir', narrator: 'R. C. Bray', coverArtUrl: 'https://m.media-amazon.com/m.jpg',
  series: null, year: 2014, description: 'Requested blurb',
};
const ROW = { plexGuid: 'abs-1', title: 'Artemis', author: 'Andy Weir', narrator: 'Rosario Dawson', cachedLibraryCoverPath: '/app/cache/library/abs-1.jpg' };
const request = (over: Record<string, unknown> = {}) => ({
  id: 'req-1', userId: 'user-1', type: 'audiobook', status: 'available', createdAt: new Date(), completedAt: new Date(),
  errorMessage: null, downloadAttempts: 0, customSearchTerms: null, selectedTorrent: null, placedEbookFiles: null,
  audiobook: { ...BOOK }, user: { id: 'user-1', plexUsername: 'reader' }, downloadHistory: [], _count: { blockedReleases: 0 },
  ...over,
});

describe('followed requests are shown as the library holds them (#325a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'user-1', role: 'admin' }, nextUrl: new URL('http://localhost/api/requests') };
    requireAuthMock.mockImplementation((_req: unknown, handler: Handler) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: unknown, handler: Handler) => handler());
    prismaMock.request.count.mockResolvedValue(1);
    prismaMock.plexLibrary.findMany.mockResolvedValue([ROW]);
  });

  it('GET /api/requests: overlay, requested audibleAsin, effective libraryAsin', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce([
      request(),
      request({ id: 'req-2', audiobook: { ...BOOK, id: 'ab-2', libraryAsin: null, absItemId: 'abs-2' } }),
      request({ id: 'req-3', type: 'ebook', status: 'downloaded' }),
    ]);
    const { GET } = await import('@/app/api/requests/route');
    const payload = await (await GET({ nextUrl: authRequest.nextUrl } as never)).json();

    const [followed, plain, ebook] = payload.requests.map((r: { audiobook: Record<string, unknown> }) => r.audiobook);
    expect(followed).toMatchObject({ title: 'Artemis', author: 'Andy Weir', coverArtUrl: '/api/cache/library/abs-1.jpg', audibleAsin: X, libraryAsin: Y, year: 2014 });
    expect(followed.filePath).toBeUndefined();
    expect(plain).toMatchObject({ title: 'The Martian', audibleAsin: X, libraryAsin: null });
    expect(ebook).toMatchObject({ title: 'The Martian', audibleAsin: X, libraryAsin: null });
    expect(prismaMock.plexLibrary.findMany).toHaveBeenCalledTimes(1);
  });

  it('GET /api/requests: a library ASIN whose item row is gone is not shown', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValueOnce([]);
    prismaMock.request.findMany.mockResolvedValueOnce([request()]);
    const { GET } = await import('@/app/api/requests/route');
    const payload = await (await GET({ nextUrl: authRequest.nextUrl } as never)).json();
    expect(payload.requests[0].audiobook).toMatchObject({ title: 'The Martian', libraryAsin: null });
  });

  it('GET /api/admin/requests: title and author follow; asin stays the requested one; libraryAsin added', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce([request(), request({ id: 'req-2', audiobook: { ...BOOK, libraryAsin: null } })]);
    const { GET } = await import('@/app/api/admin/requests/route');
    const payload = await (await GET({ url: 'http://localhost/api/admin/requests' } as never)).json();

    expect(payload.requests[0]).toMatchObject({ title: 'Artemis', author: 'Andy Weir', asin: X, libraryAsin: Y });
    expect(payload.requests[1]).toMatchObject({ title: 'The Martian', asin: X, libraryAsin: null });
    const select = prismaMock.request.findMany.mock.calls[0][0].include.audiobook.select;
    expect(select).toMatchObject({ audibleAsin: true, absItemId: true, libraryAsin: true });
  });

  it('GET /api/admin/requests?search: matches the requested or the library title; the title sort stays on the requested title', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValueOnce([{ plexGuid: 'abs-1' }]).mockResolvedValueOnce([ROW]);
    prismaMock.request.findMany.mockResolvedValueOnce([request()]);
    const { GET } = await import('@/app/api/admin/requests/route');
    const payload = await (await GET({ url: 'http://localhost/api/admin/requests?search=artemis&sortBy=title&sortOrder=asc' } as never)).json();

    const text = { contains: 'artemis', mode: 'insensitive' };
    expect(prismaMock.plexLibrary.findMany.mock.calls[0][0]).toEqual({
      where: { OR: [{ title: text }, { author: text }] }, select: { plexGuid: true }, take: 500,
    });
    const args = prismaMock.request.findMany.mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { audiobook: { OR: [{ title: text }, { author: text }] } },
      { type: 'audiobook', audiobook: { libraryAsin: { not: null }, absItemId: { in: ['abs-1'] } } },
    ]);
    expect(prismaMock.request.count.mock.calls[0][0].where).toBe(args.where); // counts use the same filter
    expect(args.orderBy).toEqual({ audiobook: { title: 'asc' } });
    expect(payload.requests[0].title).toBe('Artemis');
  });

  it('GET /api/requests/:id (admin and owner): overlay with the effective libraryAsin', async () => {
    const { GET } = await import('@/app/api/requests/[id]/route');
    const params = { params: Promise.resolve({ id: 'req-1' }) };

    prismaMock.request.findFirst.mockResolvedValueOnce(request());
    const admin = await (await GET({} as never, params)).json();
    expect(admin.request.audiobook).toMatchObject({ title: 'Artemis', audibleAsin: X, libraryAsin: Y, year: 2014, description: 'Requested blurb' });

    authRequest.user = { id: 'user-1', role: 'user' };
    prismaMock.request.findFirst.mockResolvedValueOnce(request({ audiobook: { ...BOOK, filePath: undefined } }));
    const owner = await (await GET({} as never, params)).json();
    expect(owner.request.audiobook).toMatchObject({ title: 'Artemis', audibleAsin: X, libraryAsin: Y });
    const select = prismaMock.request.findFirst.mock.calls[1][0].select;
    expect(select.audiobook.select).toMatchObject({ libraryAsin: true, absItemId: true });
  });

  it('GET /api/requests/:id: an unfollowed request reads libraryAsin null and is unchanged', async () => {
    prismaMock.request.findFirst.mockResolvedValueOnce(request({ audiobook: { ...BOOK, libraryAsin: null } }));
    const { GET } = await import('@/app/api/requests/[id]/route');
    const payload = await (await GET({} as never, { params: Promise.resolve({ id: 'req-1' }) })).json();
    expect(payload.request.audiobook).toMatchObject({ title: 'The Martian', coverArtUrl: BOOK.coverArtUrl, libraryAsin: null });
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
  });
});
