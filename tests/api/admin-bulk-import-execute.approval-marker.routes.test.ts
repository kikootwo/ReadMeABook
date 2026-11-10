/**
 * Component: Bulk import records another user's request it completes without approval (#232)
 * Documentation: documentation/features/bulk-import.md
 *
 * Bulk import recycles the book's newest request of any user when it is `failed`, `warn`,
 * `cancelled` or `denied`; a request in IMPORT_BLOCKING_STATUSES (the review screen's Requested)
 * refuses the row (#189). When the recycled request is another user's `denied` or `cancelled`
 * one, the recycle records `approvalBypassedBy = 'bulk_import:<status>'`; the importing admin's own request never is. Every
 * recycle is guarded on the exact status that was read; a row that changed meanwhile gives that
 * item an error before its job is queued, and the other items continue.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';

type Row = Record<string, unknown>;

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addOrganizeJob: vi.fn(() => Promise.resolve()) }));
const fsMock = vi.hoisted(() => ({ stat: vi.fn(), readdir: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (req: { user?: unknown }, handler: (r: unknown) => unknown) => {
    req.user = { id: 'admin-1', role: 'admin' };
    return handler(req);
  },
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => ({ getAudiobookDetails: vi.fn() }) }));
vi.mock('fs/promises', () => fsMock);

/** One request row per book (book N ↔ ASIN B00000000N ↔ request req-N). */
let rows: Map<string, Row>;
/** Runs once between the route's read of a request and its write (another change meanwhile). */
let beforeWrite: Map<string, () => void>;

function existing(n: number, over: Row = {}): void {
  rows.set(`ab-${n}`, { id: `req-${n}`, userId: 'user-2', audiobookId: `ab-${n}`, type: 'audiobook', status: 'denied', deletedAt: null, approvalBypassedBy: null, ...over });
}

const item = (n: number) => ({ folderPath: `/downloads/Author/Book ${n}`, asin: `B00000000${n}`, audioFiles: ['Book.m4b'] });
const row = (n: number) => rows.get(`ab-${n}`)!;

async function post(items: ReturnType<typeof item>[]) {
  const { POST } = await import('@/app/api/admin/bulk-import/execute/route');
  const response = await POST(new NextRequest('http://localhost/api/admin/bulk-import/execute', {
    method: 'POST',
    body: JSON.stringify({ imports: items }),
    headers: { 'content-type': 'application/json' },
  }));
  return { status: response.status, body: await response.json() };
}

const queuedFor = () => jobQueueMock.addOrganizeJob.mock.calls.map((c) => c[0]);

describe('bulk import: approval record on a recycled request (#232)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = new Map();
    beforeWrite = new Map();
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      (where.key === 'download_dir' ? { key: 'download_dir', value: '/downloads' } : null));
    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    prismaMock.audiobook.findFirst.mockImplementation(async ({ where }: { where: { audibleAsin: string } }) =>
      ({ id: `ab-${where.audibleAsin.slice(-1)}`, audibleAsin: where.audibleAsin }));
    prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: { audiobookId: string } }) => {
      const found = rows.get(where.audiobookId);
      return found ? { ...found } : null;
    });
    // The import's check for an active request (any user) reads the same rows; nothing is in the library
    prismaMock.plexLibrary.findMany.mockResolvedValue([]);
    prismaMock.request.findMany.mockImplementation(async ({ where }: { where: { audiobook: { audibleAsin: { in: string[] } }; status: { in: string[] } } }) =>
      where.audiobook.audibleAsin.in
        .filter((asin) => {
          const found = rows.get(`ab-${asin.slice(-1)}`);
          return found && where.status.in.includes(found.status as string);
        })
        .map((asin) => ({ audiobook: { audibleAsin: asin } })));
    prismaMock.request.updateMany.mockImplementation(async ({ where, data }: { where: Row; data: Row }) => {
      const target = [...rows.values()].find((r) => r.id === where.id);
      const run = target && beforeWrite.get(target.id as string);
      if (run) { beforeWrite.delete(target!.id as string); run(); }
      if (!target || target.status !== where.status) return { count: 0 };
      for (const [k, v] of Object.entries(data)) if (v !== undefined) target[k] = v;
      return { count: 1 };
    });
  });

  it.each(['denied', 'cancelled'])('another user\'s %s request is recycled, recorded bulk_import:<status>, and its job queued', async (status) => {
    existing(1, { status });

    const res = await post([item(1)]);

    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ success: true, requestId: 'req-1' });
    expect(row(1)).toMatchObject({ status: 'processing', approvalBypassedBy: `bulk_import:${status}`, userId: 'user-2', autoRerequestCount: 0 });
    expect(queuedFor()).toEqual(['req-1']);
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it.each(['failed', 'warn'])('another user\'s %s request is recycled with no record', async (status) => {
    existing(1, { status });

    const res = await post([item(1)]);

    expect(res.body.results[0]).toMatchObject({ success: true, requestId: 'req-1' });
    expect(row(1).status).toBe('processing');
    expect(row(1).approvalBypassedBy).toBeNull();
    expect(prismaMock.request.updateMany.mock.calls[0][0].data).not.toHaveProperty('approvalBypassedBy');
    expect(queuedFor()).toEqual(['req-1']);
  });

  it('an already recorded request keeps its record', async () => {
    existing(1, { status: 'failed', approvalBypassedBy: 'asin_match:awaiting_approval' });

    await post([item(1)]);

    expect(row(1)).toMatchObject({ status: 'processing', approvalBypassedBy: 'asin_match:awaiting_approval' });
  });

  it.each(['cancelled', 'denied'])('the importing admin\'s own %s request is recycled as on main with no record', async (status) => {
    existing(1, { status, userId: 'admin-1' });

    const res = await post([item(1)]);

    expect(res.body.results[0]).toMatchObject({ success: true, requestId: 'req-1' });
    expect(row(1).status).toBe('processing');
    expect(row(1).approvalBypassedBy).toBeNull();
    expect(queuedFor()).toEqual(['req-1']);
  });

  it('a request that changed before the write fails that item only; the other items continue', async () => {
    existing(1, { status: 'denied' });
    existing(2, { status: 'cancelled' });
    existing(3, { status: 'failed' });
    beforeWrite.set('req-1', () => { row(1).status = 'pending'; });

    const res = await post([item(1), item(2), item(3)]);

    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ success: false, error: 'Request changed while importing; try again' });
    expect(res.body.results[1]).toMatchObject({ success: true, requestId: 'req-2' });
    expect(res.body.results[2]).toMatchObject({ success: true, requestId: 'req-3' });
    expect(row(1)).toMatchObject({ status: 'pending', approvalBypassedBy: null });
    expect(row(2).approvalBypassedBy).toBe('bulk_import:cancelled');
    expect(queuedFor()).toEqual(['req-2', 'req-3']);
  });
});
