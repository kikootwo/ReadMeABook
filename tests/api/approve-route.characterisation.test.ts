/**
 * Component: Admin Approve Route Characterisation Tests
 * Documentation: documentation/admin-features/request-approval.md
 *
 * Every branch of POST /api/admin/requests/[id]/approve, asserted on what a caller and the
 * database see (status code, full body, the row afterwards, the jobs queued), not on which
 * Prisma calls make it happen. The request table is a small in-memory fake that honours the
 * `where` fields the route uses (id, status, deletedAt) on reads and writes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';

type Row = Record<string, unknown> & { id: string };

const db = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  histories: [] as Record<string, unknown>[],
}));

const jobQueueMock = vi.hoisted(() => ({
  addDownloadJob: vi.fn(),
  addStartDirectDownloadJob: vi.fn(),
  addSearchJob: vi.fn(),
  addSearchEbookJob: vi.fn(),
  addNotificationJob: vi.fn(),
}));
const guardMock = vi.hoisted(() => ({ torrent: vi.fn(), ebook: vi.fn() }));
const releaseGateMock = vi.hoisted(() => vi.fn());

const AUDIOBOOK = { id: 'ab-1', title: 'The Book', author: 'An Author', audibleAsin: 'B000000001' };
const USER = { id: 'user-2', plexUsername: 'reader' };

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => (value === null ? row[key] == null : row[key] === value));
}

function shaped(row: Record<string, unknown>, include: unknown) {
  return include ? { ...row, audiobook: { ...AUDIOBOOK }, user: { ...USER } } : { ...row };
}

function apply(row: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    row[key] = value === Prisma.DbNull || value === Prisma.JsonNull ? null : value;
  }
}

vi.mock('@/lib/db', () => {
  const find = async ({ where, include }: { where: Record<string, unknown>; include?: unknown }) => {
    for (const row of db.rows.values()) if (matches(row, where)) return shaped(row, include);
    return null;
  };
  return {
    prisma: {
      request: {
        findFirst: vi.fn(find),
        findUnique: vi.fn(find),
        update: vi.fn(async ({ where, data, include }: { where: Record<string, unknown>; data: Record<string, unknown>; include?: unknown }) => {
          const row = [...db.rows.values()].find((r) => matches(r, where));
          if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
          apply(row, data);
          return shaped(row, include);
        }),
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const hits = [...db.rows.values()].filter((r) => matches(r, where));
          hits.forEach((row) => apply(row, data));
          return { count: hits.length };
        }),
      },
      downloadHistory: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const history = { id: `dh-${db.histories.length + 1}`, ...data };
          db.histories.push(history);
          return history;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const history = db.histories.find((h) => h.id === where.id)!;
          Object.assign(history, data);
          return history;
        }),
      },
    },
  };
});
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) =>
    handler({ user: { id: 'admin-1', sub: 'admin-1', role: 'admin' } }),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/release-gate', () => ({ shouldWaitForRelease: releaseGateMock }));
vi.mock('@/lib/services/download-selection-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/download-selection-guard')>()),
  guardTorrentSelection: guardMock.torrent,
  guardEbookSelection: guardMock.ebook,
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const PLACED = [{ path: '/library/Author/Book/book.epub', size: 10, sha256: 'abc', placedAt: '2026-01-01T00:00:00.000Z' }];
const USER_PICK = { guid: 'g-user', title: 'User Release', downloadUrl: 'magnet:?xt=urn:btih:user' };
const ADMIN_PICK = { guid: 'g-admin', title: 'Admin Release', downloadUrl: 'magnet:?xt=urn:btih:admin' };

function seed(overrides: Record<string, unknown> = {}): Row {
  const row: Row = {
    id: 'req-1',
    userId: USER.id,
    audiobookId: AUDIOBOOK.id,
    type: 'audiobook',
    status: 'awaiting_approval',
    selectedTorrent: null,
    approvalBypassedBy: 'asin_match:awaiting_approval',
    placedEbookFiles: PLACED,
    releaseDate: null,
    deletedAt: null,
    ...overrides,
  };
  db.rows.set(row.id, row);
  return row;
}

/** The request object every success response carries: the row as stored, minus the hidden records. */
function shown(row: Record<string, unknown>) {
  const rest = { ...row };
  delete rest.placedEbookFiles;
  delete rest.approvalBypassedBy;
  return { ...rest, audiobook: AUDIOBOOK, user: USER };
}

async function post(body: unknown, id = 'req-1') {
  const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
  const response = await POST({ json: async () => body } as never, { params: Promise.resolve({ id }) });
  const text = await response.text();
  expect(text).not.toContain('placedEbookFiles');
  expect(text).not.toContain('/library/');
  return { status: response.status, body: JSON.parse(text) };
}

describe('POST /api/admin/requests/[id]/approve (characterisation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.rows.clear();
    db.histories.length = 0;
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    releaseGateMock.mockResolvedValue(false);
    guardMock.torrent.mockImplementation(async (pick: unknown) => ({ ok: true, value: pick }));
    guardMock.ebook.mockImplementation(async (pick: unknown) => ({ ok: true, value: pick }));
  });

  it('a stored user pick: 200, downloading, pick and approval record cleared, download queued', async () => {
    seed({ selectedTorrent: USER_PICK });
    const result = await post({ action: 'approve' });
    const row = db.rows.get('req-1')!;

    expect(row).toMatchObject({ status: 'downloading', selectedTorrent: null, approvalBypassedBy: null });
    expect(result).toEqual({
      status: 200,
      body: { success: true, message: 'Request approved and download started with pre-selected torrent', request: shown(row) },
    });
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith('req-1', { id: 'ab-1', title: 'The Book', author: 'An Author' }, USER_PICK);
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith('request_approved', 'req-1', 'The Book', 'An Author', 'reader');
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it('an admin pick wins over the stored pick: 200, downloading', async () => {
    seed({ selectedTorrent: USER_PICK });
    const result = await post({ action: 'approve', selectedTorrent: ADMIN_PICK });
    const row = db.rows.get('req-1')!;

    expect(row).toMatchObject({ status: 'downloading', selectedTorrent: null });
    expect(result).toEqual({
      status: 200,
      body: { success: true, message: 'Request approved and download started with admin-selected torrent', request: shown(row) },
    });
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith('req-1', expect.any(Object), ADMIN_PICK);
  });

  it("an Anna's Archive ebook pick: download history with every link, direct job with the bounded name", async () => {
    const pick = { source: 'annas_archive', md5: 'm', format: 'epub', score: 90, downloadUrl: 'https://a/1', downloadUrls: ['https://a/1', 'https://a/2'] };
    seed({ type: 'ebook', selectedTorrent: pick });
    const result = await post({ action: 'approve' });

    expect(db.histories).toEqual([
      expect.objectContaining({
        requestId: 'req-1',
        indexerName: "Anna's Archive",
        torrentName: 'The Book - An Author.epub',
        qualityScore: 90,
        downloadClient: 'direct',
        downloadStatus: 'queued',
        torrentUrl: JSON.stringify(pick.downloadUrls),
      }),
    ]);
    expect(jobQueueMock.addStartDirectDownloadJob).toHaveBeenCalledWith('req-1', 'dh-1', 'https://a/1', 'The Book - An Author.epub', undefined);
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith('request_approved', 'req-1', 'The Book (Ebook)', 'An Author', 'reader');
    expect(result.status).toBe(200);
    expect(db.rows.get('req-1')!.status).toBe('downloading');
  });

  it.each([
    ['audiobook', 'Request approved and search job triggered', 'addSearchJob'],
    ['ebook', 'Ebook request approved and ebook search job triggered', 'addSearchEbookJob'],
  ] as const)('%s with no pick: 200, pending, the type\'s search', async (type, message, job) => {
    seed({ type });
    const result = await post({ action: 'approve' });
    const row = db.rows.get('req-1')!;

    expect(row).toMatchObject({ status: 'pending', selectedTorrent: null, approvalBypassedBy: null });
    expect(result).toEqual({ status: 200, body: { success: true, message, request: shown(row) } });
    expect(jobQueueMock[job]).toHaveBeenCalledWith('req-1', { id: 'ab-1', title: 'The Book', author: 'An Author', asin: 'B000000001' });
  });

  it('an unreleased audiobook with the gate on: 200, awaiting_release, no search', async () => {
    releaseGateMock.mockResolvedValue(true);
    seed({ releaseDate: new Date('2027-05-05T00:00:00Z') });
    const result = await post({ action: 'approve' });

    expect(db.rows.get('req-1')!.status).toBe('awaiting_release');
    expect(result.body).toMatchObject({
      success: true,
      message: 'Request approved; it will be searched on its release date (May 5, 2027)',
      awaitingRelease: true,
    });
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it('an unusable stored pick: 200, pending, the pick dropped, selectionDropped says why', async () => {
    seed({ selectedTorrent: USER_PICK });
    guardMock.torrent.mockResolvedValue({ ok: false, error: 'Download link is not allowed' });
    const result = await post({ action: 'approve' });
    const row = db.rows.get('req-1')!;

    expect(row).toMatchObject({ status: 'pending', selectedTorrent: null });
    expect(result).toEqual({
      status: 200,
      body: {
        success: true,
        message: "The user's selected release could not be used (Download link is not allowed). Request approved and search job triggered instead.",
        selectionDropped: 'Download link is not allowed',
        request: shown(row),
      },
    });
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).toHaveBeenCalled();
  });

  it('a source that cannot be reached: 503 SourceUnavailable, nothing changed', async () => {
    seed({ type: 'ebook', selectedTorrent: { source: 'annas_archive', md5: 'm' } });
    guardMock.ebook.mockResolvedValue({ ok: false, error: 'Try again later', retryable: true });
    const result = await post({ action: 'approve' });

    expect(result).toEqual({ status: 503, body: { error: 'SourceUnavailable', message: 'Try again later' } });
    expect(db.rows.get('req-1')).toMatchObject({ status: 'awaiting_approval', selectedTorrent: { source: 'annas_archive', md5: 'm' } });
    expect(jobQueueMock.addStartDirectDownloadJob).not.toHaveBeenCalled();
  });

  it('a bad admin pick: 400 ValidationError with the fixed text, nothing changed', async () => {
    seed();
    guardMock.torrent.mockResolvedValue({ ok: false, error: 'Download link is not allowed' });
    const result = await post({ action: 'approve', selectedTorrent: ADMIN_PICK });

    expect(result).toEqual({
      status: 400,
      body: {
        error: 'ValidationError',
        message: 'The admin-selected release cannot be used: Download link is not allowed. Pick another release with interactive search.',
      },
    });
    expect(db.rows.get('req-1')!.status).toBe('awaiting_approval');
  });

  it.each(['approve', 'deny'])('%s on a soft-deleted request: 404, nothing changed', async (action) => {
    seed({ deletedAt: new Date('2026-01-01T00:00:00Z') });
    expect(await post({ action })).toEqual({ status: 404, body: { error: 'NotFound', message: 'Request not found' } });
    expect(db.rows.get('req-1')!.status).toBe('awaiting_approval');
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
  });

  it('a request in another status: 400 InvalidStatus with currentStatus', async () => {
    seed({ status: 'downloading' });
    expect(await post({ action: 'deny' })).toEqual({
      status: 400,
      body: { error: 'InvalidStatus', message: 'Request is not awaiting approval (current status: downloading)', currentStatus: 'downloading' },
    });
  });

  it('an invalid action: 400 with the zod issue details', async () => {
    seed();
    const result = await post({ action: 'maybe' });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: 'ValidationError', message: 'Invalid action. Must be "approve" or "deny"' });
    expect(result.body.details).toEqual([expect.objectContaining({ path: ['action'] })]);
  });

  it('a body over the limit: 413, nothing read or changed', async () => {
    seed();
    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const big = JSON.stringify({ action: 'approve', pad: 'x'.repeat(1024 * 1024 + 10) });
    const response = await POST(new Request('http://localhost/x', { method: 'POST', body: big }) as never, {
      params: Promise.resolve({ id: 'req-1' }),
    });
    expect(response.status).toBe(413);
    expect(db.rows.get('req-1')!.status).toBe('awaiting_approval');
  });

  it('deny: 200, denied, approval record kept, no notification and no job', async () => {
    seed({ selectedTorrent: USER_PICK });
    const result = await post({ action: 'deny' });
    const row = db.rows.get('req-1')!;

    expect(row).toMatchObject({ status: 'denied', selectedTorrent: USER_PICK, approvalBypassedBy: 'asin_match:awaiting_approval' });
    expect(result).toEqual({ status: 200, body: { success: true, message: 'Request denied', request: shown(row) } });
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it('a job queue failure: 500 ApprovalError with the fixed body', async () => {
    seed();
    jobQueueMock.addSearchJob.mockRejectedValue(new Error('redis down'));
    expect(await post({ action: 'approve' })).toEqual({
      status: 500,
      body: { error: 'ApprovalError', message: 'Failed to process approval action' },
    });
  });
});
