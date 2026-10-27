/**
 * Component: Discovery Routes, request details only for a checked account (real auth + matcher)
 * Documentation: documentation/backend/services/auth.md
 *
 * Popular, new releases, category and audiobook search answer without a session. They add
 * request details (status, ids, requester name) and ignore flags only when the caller's
 * account passes the same checks as requireAuth. Anyone else gets the same books with none
 * of those details. A signed-in user gets the same body as before.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/** Issued-at (seconds) of every JWT the mocked verifier hands back. */
const ISSUED_AT = vi.hoisted(() => 1_700_000_000);
const API_TOKEN = 'rmab_abcdef0123456789';

type UserRow = {
  id: string;
  role: string;
  deletedAt: Date | null;
  sessionsInvalidatedAt: Date | null;
  registrationStatus: string | null;
};

const state = vi.hoisted(() => ({
  users: {} as Record<string, UserRow>,
  apiTokenUserDeleted: false,
}));
const audibleSearch = vi.hoisted(() => vi.fn());

const BOOK_OTHER = 'B0BOOK0001'; // requested by another user
const BOOK_OWN = 'B0BOOK0002'; // requested by the caller, and ignored by the caller
const BOOK_FREE = 'B0BOOK0003'; // not requested

vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => state.users[where.id] ?? null,
    },
    apiToken: {
      findUnique: async () => ({
        id: 't1', tokenPrefix: 'rmab_abc', expiresAt: null, role: 'user',
        tokenUser: {
          id: 'u-user', plexId: 'p1', plexUsername: 'reader', role: 'user',
          deletedAt: state.apiTokenUserDeleted ? new Date('2026-10-26T00:00:00.000Z') : null,
          registrationStatus: 'approved',
        },
      }),
      update: async () => ({}),
    },
    audibleCacheCategory: {
      findMany: async () => [BOOK_OTHER, BOOK_OWN, BOOK_FREE].map((asin, i) => ({ asin, rank: i + 1 })),
      count: async () => 3,
    },
    audibleCache: {
      findMany: async () => [BOOK_OTHER, BOOK_OWN, BOOK_FREE].map((asin, i) => ({
        asin, title: `Book ${i + 1}`, author: 'Author One', narrator: null, description: null,
        coverArtUrl: null, cachedCoverPath: null, durationMinutes: 600, releaseDate: null,
        rating: null, genres: [], lastSyncedAt: null,
      })),
    },
    plexLibrary: { findMany: async () => [] },
    audiobook: {
      findMany: async () => [
        { id: 'ab-1', audibleAsin: BOOK_OTHER, requests: [{ id: 'req-1', status: 'pending', userId: 'u-other', user: { plexUsername: 'other-reader' } }] },
        { id: 'ab-2', audibleAsin: BOOK_OWN, requests: [{ id: 'req-2', status: 'downloading', userId: 'u-user', user: { plexUsername: 'reader' } }] },
        { id: 'ab-3', audibleAsin: BOOK_FREE, requests: [] },
      ],
    },
    ignoredAudiobook: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        where.userId === 'u-user' ? [{ asin: BOOK_OWN }] : [],
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
vi.mock('@/lib/processors/audible-refresh.processor', () => ({
  POPULAR_CATEGORY_ID: '__popular__',
  NEW_RELEASES_CATEGORY_ID: '__new_releases__',
}));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ search: audibleSearch }),
}));
vi.mock('@/lib/services/works.service', () => ({
  getSiblingAsins: async () => new Map(),
  persistDedupGroups: async () => {},
  collapseByExistingWorks: async (books: unknown[]) => books,
}));
vi.mock('@/lib/services/reported-issue.service', () => ({
  getOpenIssuesByAsins: async () => new Set<string>(),
}));

/** What every caller gets for each book: catalog data and availability. */
const base = (asin: string) => ({ asin, isAvailable: false, plexGuid: null, hasReportedIssue: false });

/** The body a checked account gets (unchanged from before). */
const SIGNED_IN = [
  {
    ...base(BOOK_OTHER), isRequested: true, requestStatus: 'pending', requestId: 'req-1',
    requestedByUserId: 'u-other', requestedByUsername: 'other-reader', isIgnored: false,
  },
  {
    ...base(BOOK_OWN), isRequested: true, requestStatus: 'downloading', requestId: 'req-2',
    requestedByUserId: 'u-user', isIgnored: true,
  },
  {
    ...base(BOOK_FREE), isRequested: false, requestStatus: null, requestId: null,
    requestedByUserId: null, requestedByUsername: null, isIgnored: false,
  },
];

/** The body anyone else gets: the same books, no request details. */
const NO_DETAILS = [BOOK_OTHER, BOOK_OWN, BOOK_FREE].map((asin) => ({
  ...base(asin), isRequested: false, requestStatus: null, requestId: null,
  requestedByUserId: null, requestedByUsername: null, isIgnored: false,
}));

function request(path: string, token?: string) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(`http://localhost${path}`, { method: 'GET', headers });
}

type Book = Record<string, unknown>;
type Body = { audiobooks?: Book[]; results?: Book[] };

interface RouteCase {
  name: string;
  path: string;
  call: (req: NextRequest) => Promise<Response>;
  books: (body: Body) => Book[] | undefined;
}

const routes: RouteCase[] = [
  {
    name: 'GET /api/audiobooks/popular',
    path: '/api/audiobooks/popular?page=1&limit=20',
    call: async (req) => (await import('@/app/api/audiobooks/popular/route')).GET(req),
    books: (body) => body.audiobooks,
  },
  {
    name: 'GET /api/audiobooks/new-releases',
    path: '/api/audiobooks/new-releases?page=1&limit=20',
    call: async (req) => (await import('@/app/api/audiobooks/new-releases/route')).GET(req),
    books: (body) => body.audiobooks,
  },
  {
    name: 'GET /api/audiobooks/category/:categoryId',
    path: '/api/audiobooks/category/cat-1?page=1&limit=20',
    call: async (req) =>
      (await import('@/app/api/audiobooks/category/[categoryId]/route')).GET(req, {
        params: Promise.resolve({ categoryId: 'cat-1' }),
      }),
    books: (body) => body.audiobooks,
  },
  {
    name: 'GET /api/audiobooks/search',
    path: '/api/audiobooks/search?q=book&page=1',
    call: async (req) => (await import('@/app/api/audiobooks/search/route')).GET(req),
    books: (body) => body.results,
  },
];

/** Catalog fields the routes copy through unchanged; every other field is compared. */
const CATALOG_FIELDS = new Set([
  'title', 'author', 'narrator', 'description', 'coverArtUrl', 'durationMinutes', 'releaseDate', 'rating', 'genres',
]);

/** Status and the per-book fields the assertions cover. */
async function send(route: RouteCase, token?: string) {
  const response = await route.call(request(route.path, token));
  const body = await response.json();
  const books = (route.books(body) ?? []).map((b) =>
    Object.fromEntries(Object.entries(b).filter(([key]) => !CATALOG_FIELDS.has(key))));
  return { status: response.status, books };
}

describe('discovery routes add request details only for a checked account', () => {
  beforeEach(() => {
    state.users = {
      'u-user': { id: 'u-user', role: 'user', deletedAt: null, sessionsInvalidatedAt: null, registrationStatus: 'approved' },
    };
    state.apiTokenUserDeleted = false;
    audibleSearch.mockResolvedValue({
      query: 'book',
      results: [BOOK_OTHER, BOOK_OWN, BOOK_FREE].map((asin, i) => ({
        asin, title: `Book ${i + 1}`, author: 'Author One', durationMinutes: 600,
      })),
      totalResults: 3,
      page: 1,
      hasMore: false,
    });
  });

  describe.each(routes)('$name', (route) => {
    it('gives a deleted account no request details', async () => {
      state.users['u-user'].deletedAt = new Date('2026-10-26T00:00:00.000Z');
      expect(await send(route, 'user-token')).toEqual({ status: 200, books: NO_DETAILS });
    });

    it('gives a missing account no request details', async () => {
      delete state.users['u-user'];
      expect(await send(route, 'user-token')).toEqual({ status: 200, books: NO_DETAILS });
    });

    it('gives a pending account no request details', async () => {
      state.users['u-user'].registrationStatus = 'pending_approval';
      expect(await send(route, 'user-token')).toEqual({ status: 200, books: NO_DETAILS });
    });

    it('gives a rejected account no request details', async () => {
      state.users['u-user'].registrationStatus = 'rejected';
      expect(await send(route, 'user-token')).toEqual({ status: 200, books: NO_DETAILS });
    });

    it('gives a token issued before the sessions were revoked no request details', async () => {
      state.users['u-user'].sessionsInvalidatedAt = new Date((ISSUED_AT + 60) * 1000);
      expect(await send(route, 'user-token')).toEqual({ status: 200, books: NO_DETAILS });
    });

    it('gives a request with no token no request details', async () => {
      expect(await send(route)).toEqual({ status: 200, books: NO_DETAILS });
    });

    it('gives an unverifiable token no request details', async () => {
      expect(await send(route, 'not-a-valid-token')).toEqual({ status: 200, books: NO_DETAILS });
    });

    it('gives a live account the same body as before, requester names included', async () => {
      // Sessions revoked before this token was issued do not affect it
      state.users['u-user'].sessionsInvalidatedAt = new Date((ISSUED_AT - 60) * 1000);
      expect(await send(route, 'user-token')).toEqual({ status: 200, books: SIGNED_IN });
    });
  });

  describe('API tokens', () => {
    const search = routes[3];

    it('enrich audiobook search for the token owner, as before', async () => {
      expect(await send(search, API_TOKEN)).toEqual({ status: 200, books: SIGNED_IN });
    });

    it('add no request details on search when the token owner was deleted', async () => {
      state.apiTokenUserDeleted = true;
      expect(await send(search, API_TOKEN)).toEqual({ status: 200, books: NO_DETAILS });
    });

    it.each(routes.slice(0, 3))('add no request details on $name, which is not on the API-token allowlist', async (route) => {
      expect(await send(route, API_TOKEN)).toEqual({ status: 200, books: NO_DETAILS });
    });
  });
});
