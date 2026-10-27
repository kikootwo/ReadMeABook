/**
 * Component: Interactive Search Pick on an Existing Request (#281)
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * My Requests sends a pick to the request it was opened from. The owner (or an
 * admin) may pick for it; anyone else is refused. The pick updates that request
 * and never creates a new one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

let authRequest: { user: { id: string; role: string }; json: () => Promise<unknown> };
let records: Record<string, Record<string, unknown>>;

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addDownloadJob: vi.fn(),
  addNotificationJob: vi.fn(() => Promise.resolve()),
}));
const ebookSelectionMock = vi.hoisted(() => ({
  startAnnasArchiveDownload: vi.fn(),
  startIndexerEbookDownload: vi.fn(),
}));
const prowlarrMock = vi.hoisted(() => ({ search: vi.fn(), searchWithVariations: vi.fn() }));

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
vi.mock('@/lib/services/ebook-selection.service', () => ebookSelectionMock);
vi.mock('@/lib/middleware/interactive-search-access', () => ({
  denyWithoutInteractiveSearchAccess: async () => null,
}));
vi.mock('@/lib/services/download-selection-guard', () => ({
  guardTorrentSelection: async (torrent: unknown) => ({ ok: true, value: torrent }),
  guardEbookSelection: async (ebook: unknown) => ({ ok: true, value: ebook }),
  rejectedSelectionResponse: () => NextResponse.json({ error: 'ValidationError' }, { status: 400 }),
  selectionFailureResponse: () => NextResponse.json({ error: 'ValidationError' }, { status: 400 }),
  stripProwlarrKeyFromResults: async (results: unknown) => results,
}));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({
    get: async (key: string) => ({
      ebook_indexer_search_enabled: 'true',
      prowlarr_indexers: JSON.stringify([{ id: 1, name: 'Indexer', protocol: 'torrent', priority: 10, ebookCategories: [7020] }]),
      indexer_flag_config: '[]',
    } as Record<string, string>)[key] ?? null,
    getAudibleRegion: async () => 'us',
  }),
}));
vi.mock('@/lib/integrations/prowlarr.service', () => ({ getProwlarrService: async () => prowlarrMock }));
vi.mock('@/lib/services/ebook-scraper', () => ({
  searchByAsin: vi.fn(),
  searchByTitle: vi.fn(),
  getSlowDownloadLinks: vi.fn(),
}));

const BOOK = { id: 'ab-1', audibleAsin: 'B000000001', title: 'Title', author: 'Author' };
const EBOOK_PICK = { source: 'prowlarr', guid: 'g', title: 'Title.epub', size: 1, indexer: 'Indexer', downloadUrl: 'magnet:?xt=urn:btih:abc' };
const TORRENT_PICK = { guid: 'g', title: 'Title.m4b', size: 1, indexer: 'Indexer', downloadUrl: 'magnet:?xt=urn:btih:abc' };
const DELETED_AT = new Date('2026-01-01T00:00:00Z');

const OWNER = { id: 'user-1', role: 'user' };
const OTHER_USER = { id: 'user-2', role: 'user' };
const ADMIN = { id: 'admin-1', role: 'admin' };

function asUser(user: { id: string; role: string }, body: unknown = {}) {
  authRequest = { user, json: async () => body };
  return authRequest;
}

async function call(modulePath: string, id: string, body: unknown, user: { id: string; role: string }) {
  const { POST } = await import(modulePath);
  const response = await POST(asUser(user, body), { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() };
}

const SELECT_EBOOK = '@/app/api/requests/[id]/select-ebook/route';
const SEARCH_EBOOK = '@/app/api/requests/[id]/interactive-search-ebook/route';
const SELECT_TORRENT = '@/app/api/requests/[id]/select-torrent/route';

describe('pick applied to an existing request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    records = {
      'ab-req-1': { id: 'ab-req-1', type: 'audiobook', status: 'available', userId: 'user-1', audiobookId: BOOK.id, parentRequestId: null, audiobook: BOOK },
      'ebook-1': { id: 'ebook-1', type: 'ebook', status: 'failed', userId: 'user-1', audiobookId: BOOK.id, parentRequestId: 'ab-req-1', audiobook: BOOK },
      'ebook-orphan': { id: 'ebook-orphan', type: 'ebook', status: 'awaiting_search', userId: 'user-1', audiobookId: BOOK.id, parentRequestId: null, audiobook: BOOK },
      'ab-req-2': { id: 'ab-req-2', type: 'audiobook', status: 'awaiting_search', userId: 'user-1', audiobookId: BOOK.id, parentRequestId: null, audiobook: BOOK },
      // Deleted by an admin: status kept, deletedAt set
      'ebook-del': { id: 'ebook-del', type: 'ebook', status: 'failed', userId: 'user-1', audiobookId: BOOK.id, parentRequestId: null, deletedAt: DELETED_AT, audiobook: BOOK },
      'ab-del': { id: 'ab-del', type: 'audiobook', status: 'available', userId: 'user-1', audiobookId: BOOK.id, parentRequestId: null, deletedAt: DELETED_AT, audiobook: BOOK },
    };
    prismaMock.request.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => records[where.id] ?? null);
    // Plain field equality; `deletedAt: null` matches a live record
    prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      Object.values(records).find((record) =>
        Object.entries(where).every(([key, value]) => (value === null ? record[key] == null : record[key] === value))
      ) ?? null
    );
    prismaMock.request.update.mockImplementation(
      async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ ...records[where.id], ...data })
    );
    prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      id: where.id,
      role: where.id === ADMIN.id ? 'admin' : 'user',
      autoApproveRequests: true,
      plexUsername: where.id,
    }));
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    prowlarrMock.searchWithVariations.mockResolvedValue([]);
  });

  describe('ebook request (select-ebook)', () => {
    it('owner\'s pick restarts that ebook request; no new request', async () => {
      const result = await call(SELECT_EBOOK, 'ebook-1', { ebook: EBOOK_PICK }, OWNER);

      expect(result.status).toBe(200);
      expect(result.body.requestId).toBe('ebook-1');
      expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'ebook-1' },
        data: expect.objectContaining({ status: 'searching' }),
      }));
      expect(prismaMock.request.create).not.toHaveBeenCalled();
      expect(ebookSelectionMock.startIndexerEbookDownload).toHaveBeenCalledWith('ebook-1', BOOK, EBOOK_PICK, jobQueueMock);
    });

    it('another user\'s pick is refused with 403 and changes nothing', async () => {
      const result = await call(SELECT_EBOOK, 'ebook-1', { ebook: EBOOK_PICK }, OTHER_USER);

      expect(result.status).toBe(403);
      expect(prismaMock.request.update).not.toHaveBeenCalled();
      expect(prismaMock.request.create).not.toHaveBeenCalled();
      expect(ebookSelectionMock.startIndexerEbookDownload).not.toHaveBeenCalled();
    });

    it('owner who needs approval: the pick is stored on that request and waits for an admin', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user', autoApproveRequests: false, plexUsername: 'user-1' });

      const result = await call(SELECT_EBOOK, 'ebook-1', { ebook: EBOOK_PICK }, OWNER);

      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ requestId: 'ebook-1', needsApproval: true });
      expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'ebook-1' },
        data: expect.objectContaining({ status: 'awaiting_approval', selectedTorrent: EBOOK_PICK }),
      }));
      expect(prismaMock.request.create).not.toHaveBeenCalled();
      expect(ebookSelectionMock.startIndexerEbookDownload).not.toHaveBeenCalled();
      expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith('request_pending_approval', 'ebook-1', 'Title (Ebook)', 'Author', 'user-1');
    });

    it('admin can pick for another user\'s ebook request that has no parent audiobook request', async () => {
      const result = await call(SELECT_EBOOK, 'ebook-orphan', { ebook: EBOOK_PICK }, ADMIN);

      expect(result.status).toBe(200);
      expect(result.body.requestId).toBe('ebook-orphan');
      expect(prismaMock.request.create).not.toHaveBeenCalled();
      expect(ebookSelectionMock.startIndexerEbookDownload).toHaveBeenCalledWith('ebook-orphan', BOOK, EBOOK_PICK, jobQueueMock);
    });

    it('unknown request → 404', async () => {
      const result = await call(SELECT_EBOOK, 'missing', { ebook: EBOOK_PICK }, OWNER);

      expect(result.status).toBe(404);
    });

    it('owner\'s auto-approved pick sends the request_approved notification', async () => {
      await call(SELECT_EBOOK, 'ebook-1', { ebook: EBOOK_PICK }, OWNER);

      expect(jobQueueMock.addNotificationJob).toHaveBeenCalledTimes(1);
      expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith('request_approved', 'ebook-1', 'Title (Ebook)', 'Author', 'user-1');
    });

    it('admin\'s pick sends no notification', async () => {
      const result = await call(SELECT_EBOOK, 'ebook-1', { ebook: EBOOK_PICK }, ADMIN);

      expect(result.status).toBe(200);
      expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
    });

    it('a user may not pick for an audiobook request, even their own (403, nothing changed)', async () => {
      const result = await call(SELECT_EBOOK, 'ab-req-1', { ebook: EBOOK_PICK }, OWNER);

      expect(result.status).toBe(403);
      expect(prismaMock.request.update).not.toHaveBeenCalled();
      expect(prismaMock.request.create).not.toHaveBeenCalled();
      expect(ebookSelectionMock.startIndexerEbookDownload).not.toHaveBeenCalled();
    });

    it('admin can still pick for an audiobook request (reuses its failed ebook request)', async () => {
      const result = await call(SELECT_EBOOK, 'ab-req-1', { ebook: EBOOK_PICK }, ADMIN);

      expect(result.status).toBe(200);
      expect(result.body.requestId).toBe('ebook-1');
      expect(ebookSelectionMock.startIndexerEbookDownload).toHaveBeenCalledWith('ebook-1', BOOK, EBOOK_PICK, jobQueueMock);
    });
  });

  describe('deleted request', () => {
    it.each([['owner', OWNER], ['admin', ADMIN]])(
      'select-ebook on a deleted failed ebook request → 404 for the %s, nothing changed',
      async (_label, user) => {
        const result = await call(SELECT_EBOOK, 'ebook-del', { ebook: EBOOK_PICK }, user);

        expect(result.status).toBe(404);
        expect(prismaMock.request.update).not.toHaveBeenCalled();
        expect(prismaMock.request.create).not.toHaveBeenCalled();
        expect(ebookSelectionMock.startIndexerEbookDownload).not.toHaveBeenCalled();
        expect(ebookSelectionMock.startAnnasArchiveDownload).not.toHaveBeenCalled();
      }
    );

    it.each([['owner', OWNER], ['admin', ADMIN]])(
      'select-ebook on a deleted available audiobook request → 404 for the %s, no ebook request created',
      async (_label, user) => {
        const result = await call(SELECT_EBOOK, 'ab-del', { ebook: EBOOK_PICK }, user);

        expect(result.status).toBe(404);
        expect(prismaMock.request.update).not.toHaveBeenCalled();
        expect(prismaMock.request.create).not.toHaveBeenCalled();
        expect(ebookSelectionMock.startIndexerEbookDownload).not.toHaveBeenCalled();
      }
    );

    it('select-ebook on an ebook request whose parent was deleted → 404', async () => {
      records['ebook-1'].parentRequestId = 'ab-del';

      const result = await call(SELECT_EBOOK, 'ebook-1', { ebook: EBOOK_PICK }, ADMIN);

      expect(result.status).toBe(404);
      expect(prismaMock.request.update).not.toHaveBeenCalled();
      expect(ebookSelectionMock.startIndexerEbookDownload).not.toHaveBeenCalled();
    });

    it.each([['owner', OWNER], ['admin', ADMIN]])(
      'interactive-search-ebook on a deleted ebook request → 404 for the %s, no search',
      async (_label, user) => {
        const result = await call(SEARCH_EBOOK, 'ebook-del', {}, user);

        expect(result.status).toBe(404);
        expect(prowlarrMock.searchWithVariations).not.toHaveBeenCalled();
      }
    );
  });

  describe('ebook request (interactive-search-ebook)', () => {
    it('owner can search for their own ebook request', async () => {
      const result = await call(SEARCH_EBOOK, 'ebook-1', {}, OWNER);

      expect(result.status).toBe(200);
      expect(prowlarrMock.searchWithVariations).toHaveBeenCalledTimes(1);
    });

    it('another user is refused with 403 before any search runs', async () => {
      const result = await call(SEARCH_EBOOK, 'ebook-1', {}, OTHER_USER);

      expect(result.status).toBe(403);
      expect(prowlarrMock.searchWithVariations).not.toHaveBeenCalled();
    });
  });

  describe('audiobook request (select-torrent)', () => {
    it('owner\'s pick starts the download on that request; no new request', async () => {
      const result = await call(SELECT_TORRENT, 'ab-req-2', { torrent: TORRENT_PICK }, OWNER);

      expect(result.status).toBe(200);
      expect(prismaMock.request.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'ab-req-2' },
        data: expect.objectContaining({ status: 'downloading' }),
      }));
      expect(prismaMock.request.create).not.toHaveBeenCalled();
      expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith('ab-req-2', expect.objectContaining({ id: BOOK.id }), TORRENT_PICK);
    });

    it('another user\'s pick is refused with 403', async () => {
      const result = await call(SELECT_TORRENT, 'ab-req-2', { torrent: TORRENT_PICK }, OTHER_USER);

      expect(result.status).toBe(403);
      expect(prismaMock.request.update).not.toHaveBeenCalled();
      expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    });
  });
});
