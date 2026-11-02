/**
 * Component: Manual import records another user's request it completes without approval (#232)
 * Documentation: documentation/features/manual-import.md
 *
 * An import that names no request recycles the book's newest request of any user, as before. When
 * that is another user's `awaiting_approval`, `denied` or `cancelled` request, the recycle records
 * `approvalBypassedBy = 'manual_import:<status>'`. A request the admin names (API only: the UI never
 * names one for an audiobook) counts as approved and clears an earlier record. The importing admin's
 * own request is never recorded. Every recycle is guarded on the exact status that was read; a row
 * that changed meanwhile answers 409 before any job is queued.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

type Row = Record<string, unknown>;

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addOrganizeJob: vi.fn(() => Promise.resolve()) }));
const fsMock = vi.hoisted(() => ({ stat: vi.fn(), readdir: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (r: unknown) => unknown) => handler({ user: { id: 'admin-1', role: 'admin' } }),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => ({ getAudiobookDetails: vi.fn() }) }));
vi.mock('fs/promises', () => fsMock);
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return { ...actual, default: actual, resolve: (...args: string[]) => actual.posix.resolve(...args), extname: actual.posix.extname };
});

const BOOK = { id: 'ab-1', audibleAsin: 'B00TEST0001', title: 'Book', author: 'Author', series: 'S', year: 2020, narrator: 'N' };
let row: Row;
/** Runs once between the route's read of the request and its write (another change meanwhile). */
let beforeWrite: (() => void) | null;

function existing(over: Row = {}): void {
  row = { id: 'req-old', userId: 'user-2', audiobookId: 'ab-1', type: 'audiobook', status: 'denied', deletedAt: null, approvalBypassedBy: null, ...over };
}

async function post(body: Row) {
  const { POST } = await import('@/app/api/admin/manual-import/route');
  const request = { json: vi.fn().mockResolvedValue({ folderPath: '/bookdrop/author/title', ...body }), nextUrl: new URL('http://localhost/api/admin/manual-import') };
  const response = await POST(request as never);
  return { status: response.status, body: await response.json() };
}

/** The recycle happened: the row is `processing` and the organize job was queued for it. */
function expectRecycled() {
  expect(row.status).toBe('processing');
  expect(prismaMock.request.create).not.toHaveBeenCalled();
  expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledTimes(1);
  expect(jobQueueMock.addOrganizeJob.mock.calls[0][0]).toBe('req-old');
}

describe('manual import: approval record on a recycled request (#232)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    beforeWrite = null;
    existing();
    prismaMock.configuration.findUnique.mockResolvedValue(null);
    fsMock.stat.mockImplementation(async (p: string) => {
      if (p === '/bookdrop' || p === '/bookdrop/author/title') return { isDirectory: () => true };
      throw new Error('ENOENT');
    });
    fsMock.readdir.mockResolvedValue([{ name: 'chapter1.m4b', isFile: () => true }]);
    prismaMock.audiobook.findFirst.mockResolvedValue(BOOK);
    prismaMock.audiobook.findUnique.mockResolvedValue(BOOK);
    prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: Row }) =>
      (where.id === undefined || where.id === row.id ? { ...row } : null));
    prismaMock.request.updateMany.mockImplementation(async ({ where, data }: { where: Row; data: Row }) => {
      const run = beforeWrite;
      beforeWrite = null;
      run?.();
      if (where.id !== row.id || where.status !== row.status) return { count: 0 };
      for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = v;
      return { count: 1 };
    });
  });

  it.each(['awaiting_approval', 'denied', 'cancelled'])('an unnamed import of another user\'s %s request recycles it and records manual_import:<status>', async (status) => {
    existing({ status });

    const res = await post({ asin: BOOK.audibleAsin });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, requestId: 'req-old' });
    expectRecycled();
    expect(row.approvalBypassedBy).toBe(`manual_import:${status}`);
    expect(row).toMatchObject({ progress: 100, errorMessage: null, importAttempts: 0, autoRerequestCount: 0 });
    expect(row.userId).toBe('user-2'); // still that user's request, as on main
  });

  it.each(['failed', 'warn', 'pending', 'awaiting_search', 'downloaded', 'available'])('an unnamed import of another user\'s %s request recycles it with no record', async (status) => {
    existing({ status });

    const res = await post({ asin: BOOK.audibleAsin });

    expect(res.status).toBe(200);
    expectRecycled();
    expect(row.approvalBypassedBy).toBeNull();
    expect(prismaMock.request.updateMany.mock.calls[0][0].data).not.toHaveProperty('approvalBypassedBy');
  });

  it('an unnamed import keeps an earlier record on an already recorded request', async () => {
    existing({ status: 'available', approvalBypassedBy: 'bulk_import:denied' });

    await post({ asin: BOOK.audibleAsin });

    expectRecycled();
    expect(row.approvalBypassedBy).toBe('bulk_import:denied');
  });

  it.each(['cancelled', 'awaiting_approval', 'denied'])('the importing admin\'s own %s request recycles as on main and is never recorded', async (status) => {
    existing({ status, userId: 'admin-1' });

    const res = await post({ asin: BOOK.audibleAsin });

    expect(res.status).toBe(200);
    expectRecycled();
    expect(row.approvalBypassedBy).toBeNull();
  });

  it('a named denied request (API only) counts as approved: recycled, record written as NULL', async () => {
    existing({ status: 'denied' });

    const res = await post({ requestId: 'req-old' });

    expect(res.status).toBe(200);
    expectRecycled();
    expect(prismaMock.request.updateMany.mock.calls[0][0].data).toHaveProperty('approvalBypassedBy', null);
    expect(row.approvalBypassedBy).toBeNull();
  });

  it('a named request clears an earlier record', async () => {
    existing({ status: 'available', approvalBypassedBy: 'manual_import:cancelled' });

    await post({ requestId: 'req-old' });

    expectRecycled();
    expect(row.approvalBypassedBy).toBeNull();
  });

  it.each([
    ['denied', 'pending'],
    ['failed', 'awaiting_approval'],
    ['cancelled', 'denied'],
  ])('a %s request that became %s before the write answers 409 and queues nothing', async (from, to) => {
    existing({ status: from });
    beforeWrite = () => { row.status = to; };

    const res = await post({ asin: BOOK.audibleAsin });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('This request changed while the import was starting; try again');
    expect(row.status).toBe(to);
    expect(row.approvalBypassedBy).toBeNull();
    expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });
});
