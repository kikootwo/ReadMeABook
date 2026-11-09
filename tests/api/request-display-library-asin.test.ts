/**
 * Component: Request lists and detail show the library's edition of a followed request (#325a)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * GET /api/requests and GET /api/requests/:id: an available, followed audiobook request shows the
 * linked item's title, author and cover; `audibleAsin` stays the requested ASIN; `libraryAsin` is
 * the effective value (null when the overlay does not apply). GET /api/admin/requests and /recent:
 * `title`/`author`/`asin` stay the requested ones (every row action uses them), the shown ones are
 * `displayTitle`/`displayAuthor`. The admin text filter (ABS only) also matches a followed item's
 * library title. The Prisma client omits the stored column everywhere else (src/lib/db.ts).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

type Handler = (req?: unknown) => unknown;
let authRequest: { user: { id: string; role: string }; nextUrl: URL };
const requireAuthMock = vi.hoisted(() => vi.fn());
const requireAdminMock = vi.hoisted(() => vi.fn());
const backend = vi.hoisted(() => ({ mode: 'audiobookshelf' }));
const prismaMock = createPrismaMock();

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({ requireAuth: requireAuthMock, requireAdmin: requireAdminMock }));
vi.mock('@/lib/services/download-selection-guard', () => ({ stripProwlarrKeyFromResults: async (r: unknown) => r }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => ({ addSearchJob: vi.fn(), addNotificationJob: vi.fn() }) }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn() }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => ({ getAudiobookDetails: vi.fn() }) }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ getBackendMode: async () => backend.mode }) }));

const X = 'B082BHJMFF';
const Y = 'B072R1CY4P';
const BOOK = {
  id: 'ab-1', audibleAsin: X, libraryAsin: Y, absItemId: 'abs-1', plexGuid: null, filePath: '/media/a/b',
  title: 'The Martian', author: 'Andy Weir', narrator: 'R. C. Bray', coverArtUrl: 'https://m.media-amazon.com/m.jpg',
  series: null, year: 2014, description: 'Requested blurb',
};
const ROW = { plexGuid: 'abs-1', title: 'Artemis', author: 'Andy Weir', narrator: 'Rosario Dawson', cachedLibraryCoverPath: `/app/cache/library/0123456789abcdef-${Y}.jpg` };
const request = (over: Record<string, unknown> = {}) => ({
  id: 'req-1', userId: 'user-1', type: 'audiobook', status: 'available', createdAt: new Date(), completedAt: new Date(),
  errorMessage: null, downloadAttempts: 0, customSearchTerms: null, selectedTorrent: null, placedEbookFiles: null,
  audiobook: { ...BOOK }, user: { id: 'user-1', plexUsername: 'reader' }, downloadHistory: [], _count: { blockedReleases: 0 },
  ...over,
});
const TEXT = { contains: 'artemis', mode: 'insensitive' };
const REQUESTED_TEXT = { audiobook: { OR: [{ title: TEXT }, { author: TEXT }] } };

describe('followed requests are shown as the library holds them (#325a)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRequest = { user: { id: 'user-1', role: 'admin' }, nextUrl: new URL('http://localhost/api/requests') };
    requireAuthMock.mockImplementation((_req: unknown, handler: Handler) => handler(authRequest));
    requireAdminMock.mockImplementation((_req: unknown, handler: Handler) => handler());
    prismaMock.request.count.mockResolvedValue(1);
    prismaMock.plexLibrary.findMany.mockResolvedValue([ROW]);
    backend.mode = 'audiobookshelf';
  });

  it('GET /api/requests: overlay on the available request only, requested audibleAsin, effective libraryAsin', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce([
      request(),
      request({ id: 'req-2', audiobook: { ...BOOK, id: 'ab-2', libraryAsin: null, absItemId: 'abs-2' } }),
      request({ id: 'req-3', type: 'ebook', status: 'downloaded' }),
      request({ id: 'req-4', status: 'pending' }), // a re-request after a delete that kept the link
    ]);
    const { GET } = await import('@/app/api/requests/route');
    const payload = await (await GET({ nextUrl: authRequest.nextUrl } as never)).json();

    const [followed, plain, ebook, pending] = payload.requests.map((r: { audiobook: Record<string, unknown> }) => r.audiobook);
    expect(followed).toMatchObject({ title: 'Artemis', author: 'Andy Weir', coverArtUrl: `/api/cache/library/0123456789abcdef-${Y}.jpg`, audibleAsin: X, libraryAsin: Y, year: 2014 });
    expect(followed.filePath).toBeUndefined();
    expect(plain).toMatchObject({ title: 'The Martian', audibleAsin: X, libraryAsin: null });
    expect(ebook).toMatchObject({ title: 'The Martian', audibleAsin: X, libraryAsin: null });
    expect(pending).toMatchObject({ title: 'The Martian', coverArtUrl: BOOK.coverArtUrl, libraryAsin: null });
    expect(prismaMock.plexLibrary.findMany).toHaveBeenCalledTimes(1);
    // the stored column is read only for the overlay (the client omits it everywhere else)
    expect(prismaMock.request.findMany.mock.calls[0][0].include.audiobook).toEqual({ omit: { libraryAsin: false } });
  });

  it('GET /api/requests: a library ASIN whose item row is gone is not shown', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValueOnce([]);
    prismaMock.request.findMany.mockResolvedValueOnce([request()]);
    const { GET } = await import('@/app/api/requests/route');
    const payload = await (await GET({ nextUrl: authRequest.nextUrl } as never)).json();
    expect(payload.requests[0].audiobook).toMatchObject({ title: 'The Martian', libraryAsin: null });
  });

  it('GET /api/admin/requests: the requested title, author and asin for every action; the shown ones apart', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce([
      request({ audiobook: { ...BOOK, author: 'Requested Author' } }),
      request({ id: 'req-2', audiobook: { ...BOOK, libraryAsin: null } }),
      request({ id: 'req-3', status: 'downloading' }),
    ]);
    const { GET } = await import('@/app/api/admin/requests/route');
    const payload = await (await GET({ url: 'http://localhost/api/admin/requests' } as never)).json();

    expect(payload.requests[0]).toMatchObject({
      title: 'The Martian', author: 'Requested Author', displayTitle: 'Artemis', displayAuthor: 'Andy Weir', asin: X, libraryAsin: Y,
    });
    expect(payload.requests[1]).toMatchObject({ title: 'The Martian', displayTitle: 'The Martian', asin: X, libraryAsin: null });
    expect(payload.requests[2]).toMatchObject({ title: 'The Martian', displayTitle: 'The Martian', libraryAsin: null });
    const select = prismaMock.request.findMany.mock.calls[0][0].include.audiobook.select;
    expect(select).toMatchObject({ audibleAsin: true, absItemId: true, libraryAsin: true });
  });

  it("GET /api/admin/requests?search: the requested title, or a followed item's library title; the title sort stays on the requested title", async () => {
    prismaMock.audiobook.findMany.mockResolvedValueOnce([{ absItemId: 'abs-1' }, { absItemId: 'abs-9' }]);
    prismaMock.plexLibrary.findMany.mockResolvedValueOnce([{ plexGuid: 'abs-1' }]).mockResolvedValueOnce([ROW]);
    prismaMock.request.findMany.mockResolvedValueOnce([request()]);
    const { GET } = await import('@/app/api/admin/requests/route');
    const payload = await (await GET({ url: 'http://localhost/api/admin/requests?search=artemis&sortBy=title&sortOrder=asc' } as never)).json();

    expect(prismaMock.audiobook.findMany.mock.calls[0][0]).toEqual({
      where: { libraryAsin: { not: null }, absItemId: { not: null }, requests: { some: { type: 'audiobook', status: 'available', deletedAt: null } } },
      select: { absItemId: true },
    });
    expect(prismaMock.plexLibrary.findMany.mock.calls[0][0]).toEqual({
      where: { plexGuid: { in: ['abs-1', 'abs-9'] }, OR: [{ title: TEXT }, { author: TEXT }] },
      select: { plexGuid: true },
      orderBy: { plexGuid: 'asc' },
    });
    const args = prismaMock.request.findMany.mock.calls[0][0];
    expect(args.where.OR).toEqual([
      REQUESTED_TEXT,
      { type: 'audiobook', status: 'available', audiobook: { libraryAsin: { not: null }, absItemId: { in: ['abs-1'] } } },
    ]);
    expect(prismaMock.request.count.mock.calls[0][0].where).toBe(args.where); // counts use the same filter
    expect(args.orderBy).toEqual({ audiobook: { title: 'asc' } });
    expect(payload.requests[0]).toMatchObject({ title: 'The Martian', displayTitle: 'Artemis' });
  });

  it.each([
    ['Plex mode: no library query at all', 'plex', 0],
    ['ABS with no followed book: no plex_library query', 'audiobookshelf', 1],
  ])('GET /api/admin/requests?search, %s', async (_label, mode, bookQueries) => {
    backend.mode = mode;
    prismaMock.audiobook.findMany.mockResolvedValueOnce([]);
    prismaMock.request.findMany.mockResolvedValueOnce([]);
    const { GET } = await import('@/app/api/admin/requests/route');
    await GET({ url: 'http://localhost/api/admin/requests?search=artemis' } as never);
    expect(prismaMock.request.findMany.mock.calls[0][0].where.OR).toEqual([REQUESTED_TEXT]);
    expect(prismaMock.audiobook.findMany).toHaveBeenCalledTimes(bookQueries);
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
  });

  it('GET /api/admin/requests/recent: the same fields as the admin list', async () => {
    prismaMock.request.findMany.mockResolvedValueOnce([request(), request({ id: 'req-2', status: 'pending' })]);
    const { GET } = await import('@/app/api/admin/requests/recent/route');
    const payload = await (await GET({} as never)).json();

    expect(payload.requests[0]).toMatchObject({ requestId: 'req-1', title: 'The Martian', displayTitle: 'Artemis', displayAuthor: 'Andy Weir', libraryAsin: Y });
    expect(payload.requests[1]).toMatchObject({ requestId: 'req-2', title: 'The Martian', displayTitle: 'The Martian', libraryAsin: null });
    expect(prismaMock.request.findMany.mock.calls[0][0].include.audiobook.select).toMatchObject({ absItemId: true, libraryAsin: true });
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
    expect(prismaMock.request.findFirst.mock.calls[0][0].include.audiobook).toEqual({ omit: { libraryAsin: false } });
    const select = prismaMock.request.findFirst.mock.calls[1][0].select;
    expect(select.audiobook.select).toMatchObject({ libraryAsin: true, absItemId: true });
  });

  it("GET /api/requests/:id: another user's request is refused before any library lookup", async () => {
    authRequest.user = { id: 'user-2', role: 'user' };
    prismaMock.request.findFirst.mockResolvedValueOnce(request());
    const { GET } = await import('@/app/api/requests/[id]/route');
    const res = await GET({} as never, { params: Promise.resolve({ id: 'req-1' }) });
    expect(res.status).toBe(403);
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
  });

  it('GET /api/requests/:id: an unfollowed request reads libraryAsin null and is unchanged', async () => {
    prismaMock.request.findFirst.mockResolvedValueOnce(request({ audiobook: { ...BOOK, libraryAsin: null } }));
    const { GET } = await import('@/app/api/requests/[id]/route');
    const payload = await (await GET({} as never, { params: Promise.resolve({ id: 'req-1' }) })).json();
    expect(payload.request.audiobook).toMatchObject({ title: 'The Martian', coverArtUrl: BOOK.coverArtUrl, libraryAsin: null });
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
  });
});
