/**
 * Component: Deleted Requests Refuse Searches and Picks (#470)
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * A deleted request answers 404 on every route that starts a search or a
 * download for it, for its owner and for an admin, and nothing is searched or
 * enqueued. A live request still works.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

type User = { id: string; role: string };

let authRequest: { user: User; json: () => Promise<unknown> };
let records: Record<string, Record<string, unknown>>;

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addDownloadJob: vi.fn(),
  addSearchJob: vi.fn(),
  addSearchEbookJob: vi.fn(),
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));
const prowlarrMock = vi.hoisted(() => ({ searchWithVariations: vi.fn() }));
const CONFIG: Record<string, string> = {
  ebook_indexer_search_enabled: 'true',
  prowlarr_indexers: JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, audiobookCategories: [3030] }]),
  indexer_flag_config: '[]',
};

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) => handler(authRequest),
  // Same contract as the real middleware: only admins get through
  requireAdmin: (req: { user?: { role?: string } }, handler: (req: unknown) => unknown) =>
    req.user?.role === 'admin'
      ? handler(req)
      : NextResponse.json({ error: 'Forbidden', message: 'Admin access required' }, { status: 403 }),
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/middleware/interactive-search-access', () => ({
  denyWithoutInteractiveSearchAccess: async () => null,
}));
vi.mock('@/lib/services/download-selection-guard', () => ({
  guardTorrentSelection: async (torrent: unknown) => ({ ok: true, value: torrent }),
  rejectedSelectionResponse: () => NextResponse.json({ error: 'ValidationError' }, { status: 400 }),
  stripProwlarrKeyFromResults: async (results: unknown) => results,
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    get: async (key: string) => CONFIG[key] ?? null,
    getAudibleRegion: async () => 'us',
  }),
}));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ getProwlarrService: async () => prowlarrMock }));

// No ASIN, so interactive search makes no runtime lookup
const BOOK = { id: 'ab-1', audibleAsin: null, title: 'Title', author: 'Author' };
const TORRENT_PICK = { guid: 'g', title: 'Title.m4b', size: 1, indexer: 'Indexer', downloadUrl: 'magnet:?xt=urn:btih:abc' };
const DELETED_AT = new Date('2026-01-01T00:00:00Z');
const NOT_FOUND = { error: 'NotFound', message: 'Request not found' };

const OWNER: User = { id: 'user-1', role: 'user' };
const ADMIN: User = { id: 'admin-1', role: 'admin' };
const OWNER_AND_ADMIN: Array<[string, User]> = [['owner', OWNER], ['admin', ADMIN]];

const SELECT_TORRENT = '@/app/api/requests/[id]/select-torrent/route';
const INTERACTIVE_SEARCH = '@/app/api/requests/[id]/interactive-search/route';
const MANUAL_SEARCH = '@/app/api/requests/[id]/manual-search/route';
const FETCH_EBOOK = '@/app/api/requests/[id]/fetch-ebook/route';

function request(id: string, fields: Record<string, unknown>) {
  return { id, type: 'audiobook', userId: OWNER.id, audiobookId: BOOK.id, parentRequestId: null, deletedAt: null, customSearchTerms: null, audiobook: BOOK, ...fields };
}

/** Plain field equality, as Prisma applies it; `null` matches a missing or null field */
function matching(where: Record<string, unknown>) {
  return Object.values(records).find((record) =>
    Object.entries(where).every(([key, value]) => (value === null ? record[key] == null : record[key] === value))
  ) ?? null;
}

async function call(modulePath: string, id: string, body: unknown, user: User) {
  authRequest = { user, json: async () => body };
  const { POST } = await import(modulePath);
  const response = await POST(authRequest, { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() };
}

function expectNothingStarted() {
  expect(prowlarrMock.searchWithVariations).not.toHaveBeenCalled();
  expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
  expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
  expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  expect(prismaMock.request.update).not.toHaveBeenCalled();
  expect(prismaMock.request.create).not.toHaveBeenCalled();
}

describe('deleted requests refuse searches and picks (#470)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    records = {
      'ab-live': request('ab-live', { status: 'failed' }),
      'ab-done': request('ab-done', { status: 'available' }),
      'ebook-live': request('ebook-live', { type: 'ebook', status: 'failed' }),
      // Deleted by an admin: status kept, deletedAt set
      'ab-del': request('ab-del', { status: 'failed', deletedAt: DELETED_AT }),
      'ab-done-del': request('ab-done-del', { status: 'available', deletedAt: DELETED_AT }),
      'ebook-del': request('ebook-del', { type: 'ebook', status: 'failed', deletedAt: DELETED_AT }),
    };
    prismaMock.request.findUnique.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => matching(where));
    prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => matching(where));
    prismaMock.request.update.mockImplementation(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ ...records[where.id], ...data })
    );
    prismaMock.request.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ebook-new', ...data }));
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      role: where.id === ADMIN.id ? 'admin' : 'user',
      autoApproveRequests: true,
      plexUsername: where.id,
    }));
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      CONFIG[where.key] === undefined ? null : { key: where.key, value: CONFIG[where.key] }
    );
    prowlarrMock.searchWithVariations.mockResolvedValue([]);
  });

  describe('select-torrent', () => {
    it.each(OWNER_AND_ADMIN)('deleted request: 404 for the %s, nothing enqueued', async (_label, user) => {
      const result = await call(SELECT_TORRENT, 'ab-del', { torrent: TORRENT_PICK }, user);

      expect(result).toEqual({ status: 404, body: NOT_FOUND });
      expectNothingStarted();
    });

    it('live request: the pick starts the download', async () => {
      const result = await call(SELECT_TORRENT, 'ab-live', { torrent: TORRENT_PICK }, OWNER);

      expect(result.status).toBe(200);
      expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith('ab-live', expect.objectContaining({ id: BOOK.id }), TORRENT_PICK);
    });
  });

  describe('interactive-search', () => {
    it.each(OWNER_AND_ADMIN)('deleted request: 404 for the %s, no search', async (_label, user) => {
      const result = await call(INTERACTIVE_SEARCH, 'ab-del', {}, user);

      expect(result).toEqual({ status: 404, body: NOT_FOUND });
      expectNothingStarted();
    });

    it('live request: the search runs', async () => {
      const result = await call(INTERACTIVE_SEARCH, 'ab-live', {}, OWNER);

      expect(result.status).toBe(200);
      expect(prowlarrMock.searchWithVariations).toHaveBeenCalledWith('Title', 'Author', expect.objectContaining({ indexerIds: [1] }), { exactTitle: false });
    });
  });

  describe('manual-search', () => {
    it.each(OWNER_AND_ADMIN)('deleted audiobook request: 404 for the %s, no search job', async (_label, user) => {
      const result = await call(MANUAL_SEARCH, 'ab-del', {}, user);

      expect(result).toEqual({ status: 404, body: NOT_FOUND });
      expectNothingStarted();
    });

    it.each(OWNER_AND_ADMIN)('deleted ebook request: 404 for the %s, no ebook search job', async (_label, user) => {
      const result = await call(MANUAL_SEARCH, 'ebook-del', {}, user);

      expect(result).toEqual({ status: 404, body: NOT_FOUND });
      expectNothingStarted();
    });

    it('live request: the search job is enqueued', async () => {
      const result = await call(MANUAL_SEARCH, 'ab-live', {}, OWNER);

      expect(result.status).toBe(200);
      expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('ab-live', expect.objectContaining({ id: BOOK.id }));
    });
  });

  describe('fetch-ebook (admin only)', () => {
    it('deleted request: 404 for an admin, no ebook request and no search job', async () => {
      const result = await call(FETCH_EBOOK, 'ab-done-del', {}, ADMIN);

      expect(result).toEqual({ status: 404, body: { error: 'Request not found' } });
      expectNothingStarted();
    });

    it('deleted request: its owner is refused by the admin check, nothing started', async () => {
      const result = await call(FETCH_EBOOK, 'ab-done-del', {}, OWNER);

      expect(result.status).toBe(403);
      expectNothingStarted();
    });

    it('live request: an ebook request is created and searched', async () => {
      const result = await call(FETCH_EBOOK, 'ab-done', {}, ADMIN);

      expect(result.status).toBe(200);
      expect(prismaMock.request.create).toHaveBeenCalledWith({ data: expect.objectContaining({ parentRequestId: 'ab-done', type: 'ebook' }) });
      expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledWith('ebook-new', expect.objectContaining({ id: BOOK.id }));
    });
  });
});
