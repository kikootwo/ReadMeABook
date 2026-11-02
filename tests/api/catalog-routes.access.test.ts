/**
 * Component: Author and Series Catalog Routes — access rules (real auth middleware)
 * Documentation: documentation/backend/services/auth.md
 *
 * The author and series catalog handlers go through requireAuth like the other signed-in
 * routes: the account must still exist and its sessions must not be revoked. A signed-in
 * user gets the same response as before.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AUDIBLE_REGIONS } from '@/lib/types/audible';

/** Issued-at (seconds) of every JWT the mocked verifier hands back. */
const ISSUED_AT = vi.hoisted(() => 1_700_000_000);

type UserRow = { id: string; deletedAt: Date | null; sessionsInvalidatedAt: Date | null };

const state = vi.hoisted(() => ({ users: {} as Record<string, UserRow> }));

const catalog = vi.hoisted(() => ({
  fetchAuthorDetail: vi.fn(),
  searchAuthors: vi.fn(),
  searchByAuthorAsin: vi.fn(),
  scrapeSeriesPage: vi.fn(),
  searchForSeries: vi.fn(),
  enrich: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => state.users[where.id] ?? null,
    },
    apiToken: {
      findUnique: async () => ({
        id: 't1', tokenPrefix: 'rmab_abc', expiresAt: null, role: 'user',
        tokenUser: { id: 'u-user', plexId: 'p1', plexUsername: 'reader', role: 'user', deletedAt: null },
      }),
      update: async () => ({}),
    },
  },
}));
vi.mock('@/lib/utils/jwt', () => ({
  verifyAccessToken: (token: string) =>
    token === 'user-token' ? { sub: 'u-user', role: 'user', plexId: 'p1', username: 'reader', iat: ISSUED_AT } : null,
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ getAudibleRegion: async () => 'us' }),
}));
vi.mock('@/lib/integrations/audnexus-authors', () => ({
  fetchAuthorDetail: catalog.fetchAuthorDetail,
  searchAuthors: catalog.searchAuthors,
}));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ searchByAuthorAsin: catalog.searchByAuthorAsin }),
}));
vi.mock('@/lib/integrations/audible-series', () => ({
  scrapeSeriesPage: catalog.scrapeSeriesPage,
  searchForSeries: catalog.searchForSeries,
  SeriesSearchUnavailableError: class SeriesSearchUnavailableError extends Error {},
}));
vi.mock('@/lib/services/works.service', () => ({
  persistDedupGroups: async () => {},
  collapseByExistingWorks: async (books: unknown[]) => books,
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ enrichAudiobooksWithMatches: catalog.enrich }));
vi.mock('@/lib/utils/ignored-audiobooks', () => ({
  annotateWithIgnoreStatus: async (books: unknown[]) => books,
}));

const AUTHOR = 'B0AUTHOR01';
const SIMILAR = 'B0AUTHOR02';
const SERIES = 'B0SERIES01';
const book = { asin: 'B0BOOK0001', title: 'Book One', author: 'Author One', narrator: 'Narrator One', durationMinutes: 600 };
const enrichedBook = { ...book, isAvailable: false, enrichedFor: 'u-user' };

const params = (asin: string) => ({ params: Promise.resolve({ asin }) });

function request(path: string, token?: string) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(`http://localhost${path}`, { method: 'GET', headers });
}

interface RouteCase {
  name: string;
  path: string;
  call: (req: NextRequest) => Promise<Response>;
  lookup: ReturnType<typeof vi.fn>;
  expected: unknown;
}

const routes: RouteCase[] = [
  {
    name: 'GET /api/authors/:asin',
    path: `/api/authors/${AUTHOR}`,
    call: async (req) => (await import('@/app/api/authors/[asin]/route')).GET(req, params(AUTHOR)),
    lookup: catalog.fetchAuthorDetail,
    expected: {
      success: true,
      author: {
        asin: AUTHOR, name: 'Author One', description: 'Bio', image: 'img-1', genres: ['Fantasy'],
        similar: [{ asin: SIMILAR, name: 'Author Two', image: 'img-2' }],
        audibleUrl: `${AUDIBLE_REGIONS.us.baseUrl}/author/${AUTHOR}`,
      },
    },
  },
  {
    name: 'GET /api/authors/:asin/books',
    path: `/api/authors/${AUTHOR}/books?name=Author%20One`,
    call: async (req) => (await import('@/app/api/authors/[asin]/books/route')).GET(req, params(AUTHOR)),
    lookup: catalog.searchByAuthorAsin,
    expected: {
      success: true, books: [enrichedBook], authorName: 'Author One', authorAsin: AUTHOR,
      totalBooks: 1, hasMore: false, page: 1,
    },
  },
  {
    name: 'GET /api/authors/search',
    path: '/api/authors/search?name=author%20one',
    call: async (req) => (await import('@/app/api/authors/search/route')).GET(req),
    lookup: catalog.searchAuthors,
    expected: {
      success: true,
      authors: [{ asin: AUTHOR, name: 'Author One', description: 'Bio', image: 'img-1', genres: ['Fantasy'], similarCount: 1 }],
      query: 'author one',
    },
  },
  {
    name: 'GET /api/series/:asin',
    path: `/api/series/${SERIES}`,
    call: async (req) => (await import('@/app/api/series/[asin]/route')).GET(req, params(SERIES)),
    lookup: catalog.scrapeSeriesPage,
    expected: {
      success: true,
      series: { asin: SERIES, title: 'Series One', hasMore: false, page: 1, books: [enrichedBook] },
      hasMore: false,
      page: 1,
    },
  },
  {
    name: 'GET /api/series/search',
    path: '/api/series/search?q=series%20one',
    call: async (req) => (await import('@/app/api/series/search/route')).GET(req),
    lookup: catalog.searchForSeries,
    expected: { success: true, series: [{ asin: SERIES, title: 'Series One' }], query: 'series one' },
  },
];

const send = (route: RouteCase, token?: string) => route.call(request(route.path, token));

describe('author and series catalog routes use the standard session check', () => {
  beforeEach(() => {
    state.users = { 'u-user': { id: 'u-user', deletedAt: null, sessionsInvalidatedAt: null } };
    catalog.fetchAuthorDetail.mockImplementation(async (asin: string) =>
      asin === AUTHOR
        ? { asin, name: 'Author One', description: 'Bio', image: 'img-1', genres: [{ name: 'Fantasy' }], similar: [{ asin: SIMILAR, name: 'Author Two' }] }
        : { asin, name: 'Author Two', image: 'img-2' });
    catalog.searchAuthors.mockResolvedValue([{ asin: AUTHOR, name: 'Author One' }]);
    catalog.searchByAuthorAsin.mockResolvedValue({ books: [book], hasMore: false, page: 1 });
    catalog.scrapeSeriesPage.mockResolvedValue({ asin: SERIES, title: 'Series One', books: [book], hasMore: false, page: 1 });
    catalog.searchForSeries.mockResolvedValue([{ asin: SERIES, title: 'Series One' }]);
    catalog.enrich.mockImplementation(async (books: object[], userId?: string) =>
      books.map((b) => ({ ...b, isAvailable: false, enrichedFor: userId })));
  });

  describe.each(routes)('$name', (route) => {
    it('refuses a user whose account was deleted (401)', async () => {
      state.users['u-user'].deletedAt = new Date('2026-10-26T00:00:00.000Z');

      const response = await send(route, 'user-token');

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: 'Unauthorized' });
      expect(route.lookup).not.toHaveBeenCalled();
    });

    it('refuses a user whose account row is gone (401)', async () => {
      delete state.users['u-user'];

      const response = await send(route, 'user-token');

      expect(response.status).toBe(401);
      expect(route.lookup).not.toHaveBeenCalled();
    });

    it('refuses a token issued before the sessions were revoked (401)', async () => {
      state.users['u-user'].sessionsInvalidatedAt = new Date((ISSUED_AT + 60) * 1000);

      const response = await send(route, 'user-token');

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: 'Unauthorized', message: 'Session has been revoked' });
      expect(route.lookup).not.toHaveBeenCalled();
    });

    it('refuses an API token (403, not on the API-token allowlist)', async () => {
      const response = await send(route, 'rmab_abcdef0123456789');

      expect(response.status).toBe(403);
      expect(route.lookup).not.toHaveBeenCalled();
    });

    it('refuses a request with no token (401)', async () => {
      const response = await send(route);

      expect(response.status).toBe(401);
      expect(route.lookup).not.toHaveBeenCalled();
    });

    it('serves a signed-in user with the same response as before', async () => {
      // Sessions revoked before this token was issued do not affect it
      state.users['u-user'].sessionsInvalidatedAt = new Date((ISSUED_AT - 60) * 1000);

      const response = await send(route, 'user-token');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(route.expected);
      expect(route.lookup).toHaveBeenCalled();
    });
  });

  it('enriches author and series books for the signed-in user', async () => {
    await send(routes[1], 'user-token');
    await send(routes[3], 'user-token');

    expect(catalog.enrich).toHaveBeenCalledTimes(2);
    expect(catalog.enrich.mock.calls.map((call) => call[1])).toEqual(['u-user', 'u-user']);
  });
});
