/**
 * Component: Bulk import execute checks every row the same way (#189, #588)
 * Documentation: documentation/features/bulk-import.md
 *
 * Before anything is written, each row needs an ASIN-shaped ASIN (a missing one runs no lookup,
 * #588), an ASIN no other row in the call names, a book that resolves, a book not in the library,
 * and no request by any user in IMPORT_BLOCKING_STATUSES. There is no media-folder check here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createPrismaMock } from '../helpers/prisma';
import { IMPORT_BLOCKING_STATUSES } from '@/lib/constants/request-statuses';

type Row = Record<string, unknown>;

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({ addOrganizeJob: vi.fn() }));
const audibleMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn() }));
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
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audibleMock }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

/** Books in the audiobooks table by ASIN; plex_library rows; requests (with the book's ASIN). */
let books: Map<string, Row>;
let library: Row[];
let requests: Row[];

const item = (asin: unknown, folder = `/downloads/Author/${String(asin)}`) => ({ folderPath: folder, asin, audioFiles: ['Book.m4b'] });

async function post(imports: unknown[]) {
  const { POST } = await import('@/app/api/admin/bulk-import/execute/route');
  const response = await POST(new NextRequest('http://localhost/api/admin/bulk-import/execute', {
    method: 'POST',
    body: JSON.stringify({ imports }),
    headers: { 'content-type': 'application/json' },
  }));
  return { status: response.status, body: await response.json() };
}

const lookups = () =>
  prismaMock.audiobook.findFirst.mock.calls.length + prismaMock.audibleCache.findUnique.mock.calls.length + audibleMock.getAudiobookDetails.mock.calls.length;
const nothingWritten = () => {
  expect(prismaMock.request.create).not.toHaveBeenCalled();
  expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
  expect(prismaMock.audiobook.create).not.toHaveBeenCalled();
  expect(jobQueueMock.addOrganizeJob).not.toHaveBeenCalled();
};

describe('bulk import execute: the same checks on every row', () => {
  beforeEach(() => {
    books = new Map([
      ['B0BOOK0001', { id: 'ab-1', audibleAsin: 'B0BOOK0001' }],
      ['B0BOOK0002', { id: 'ab-2', audibleAsin: 'B0BOOK0002' }],
      ['B0BOOK0003', { id: 'ab-3', audibleAsin: 'B0BOOK0003' }],
    ]);
    library = [];
    requests = [];
    prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      ({ download_dir: { value: '/downloads' }, media_dir: { value: '/media' } } as Record<string, Row>)[where.key] ?? null);
    fsMock.stat.mockResolvedValue({ isDirectory: () => true });
    prismaMock.audiobook.findFirst.mockImplementation(async ({ where }: { where: { audibleAsin: string } }) => books.get(where.audibleAsin) ?? null);
    prismaMock.audibleCache.findUnique.mockResolvedValue(null);
    audibleMock.getAudiobookDetails.mockResolvedValue(null);
    prismaMock.plexLibrary.findMany.mockImplementation(async () => library);
    prismaMock.request.findMany.mockImplementation(async ({ where }: { where: { audiobook: { audibleAsin: { in: string[] } }; status: { in: string[] } } }) =>
      requests
        .filter((r) => where.audiobook.audibleAsin.in.includes(r.asin as string) && where.status.in.includes(r.status as string))
        .map((r) => ({ audiobook: { audibleAsin: r.asin } })));
    prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: { audiobookId: string } }) =>
      requests.find((r) => books.get(r.asin as string)?.id === where.audiobookId) ?? null);
    prismaMock.request.create.mockImplementation(async () => ({ id: 'req-new' }));
    prismaMock.audiobook.create.mockImplementation(async ({ data }: { data: Row }) => ({ id: 'ab-new', ...data }));
    jobQueueMock.addOrganizeJob.mockResolvedValue(undefined);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a string', 12345],
    ['too short', 'B0BOOK'],
    ['with a path', 'B0/../x/yz'],
  ])('refuses a %s ASIN with a reason and runs no lookup (#588)', async (_label, asin) => {
    const res = await post([item(asin)]);

    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ success: false, error: 'Invalid ASIN' });
    expect(lookups()).toBe(0);
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
    nothingWritten();
  });

  it('reads a lower-case ASIN upper-cased', async () => {
    const res = await post([item('b0book0001')]);

    expect(res.body.results[0]).toMatchObject({ success: true, asin: 'B0BOOK0001', requestId: 'req-new' });
    expect(prismaMock.audiobook.findFirst).toHaveBeenCalledWith({ where: { audibleAsin: 'B0BOOK0001' } });
  });

  it('refuses every row that names the same book (any case), runs no lookup for them, and queues the others', async () => {
    const res = await post([item('B0BOOK0001'), item('B0BOOK0002'), item('b0book0001', '/downloads/Other folder')]);

    expect(res.body.results.map((r: Row) => [r.success, r.error ?? null])).toEqual([
      [false, 'Same book as another row'],
      [true, null],
      [false, 'Same book as another row'],
    ]);
    expect(prismaMock.audiobook.findFirst.mock.calls.map((c) => c[0].where.audibleAsin)).toEqual(['B0BOOK0002']);
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledTimes(1);
  });

  it('refuses two tag groups in one folder that share an ASIN; nothing is queued', async () => {
    const folder = '/downloads/Author/Mixed folder';
    const res = await post([
      { folderPath: folder, asin: 'B0BOOK0003', audioFiles: ['a.m4b'] },
      { folderPath: folder, asin: 'B0BOOK0003', audioFiles: ['b.m4b'] },
    ]);

    expect(res.body.results).toEqual([
      expect.objectContaining({ success: false, error: 'Same book as another row' }),
      expect.objectContaining({ success: false, error: 'Same book as another row' }),
    ]);
    nothingWritten();
  });

  it('refuses a book that resolves nowhere (database, cache, live)', async () => {
    const res = await post([item('B0NOPE0001')]);

    expect(res.body.results[0]).toMatchObject({ success: false, error: 'Audiobook not found' });
    expect(audibleMock.getAudiobookDetails).toHaveBeenCalledWith('B0NOPE0001', { fillSeries: true });
    nothingWritten();
  });

  it('refuses a row whose live lookup fails', async () => {
    audibleMock.getAudiobookDetails.mockRejectedValue(new Error('socket hang up'));

    const res = await post([item('B0NOPE0001')]);

    expect(res.body.results[0]).toMatchObject({ success: false, error: 'Failed to fetch audiobook details' });
    nothingWritten();
  });

  it.each([
    ['its ASIN field (other case)', { asin: 'b0book0001', plexGuid: 'abs-item-1' }],
    ['its GUID', { asin: null, plexGuid: 'com.plexapp.agents.audible://B0BOOK0001?lang=en' }],
  ])('refuses a book already in the library, matched by %s', async (_label, libraryRow) => {
    library = [libraryRow];

    const res = await post([item('B0BOOK0001')]);

    expect(res.body.results[0]).toMatchObject({ success: false, error: 'Already in your library' });
    nothingWritten();
  });

  it.each(IMPORT_BLOCKING_STATUSES.map((s) => [s]))('refuses a book another user has a %s request for', async (status) => {
    requests = [{ id: 'req-9', userId: 'user-2', asin: 'B0BOOK0001', status }];

    const res = await post([item('B0BOOK0001')]);

    expect(res.body.results[0]).toMatchObject({ success: false, error: 'Already requested' });
    expect(prismaMock.request.findMany.mock.calls[0][0].where).toMatchObject({ type: 'audiobook', deletedAt: null, status: { in: [...IMPORT_BLOCKING_STATUSES] } });
    nothingWritten();
  });

  it('refuses the importing admin\'s own active request too', async () => {
    requests = [{ id: 'req-9', userId: 'admin-1', asin: 'B0BOOK0001', status: 'awaiting_approval' }];

    const res = await post([item('B0BOOK0001')]);

    expect(res.body.results[0]).toMatchObject({ success: false, error: 'Already requested' });
    nothingWritten();
  });

  it('refuses a row whose request became active between the check and the write', async () => {
    // The active-request query sees nothing; the newest request read just after is pending
    prismaMock.request.findMany.mockResolvedValue([]);
    requests = [{ id: 'req-9', userId: 'user-2', asin: 'B0BOOK0001', status: 'pending' }];

    const res = await post([item('B0BOOK0001')]);

    expect(res.body.results[0]).toMatchObject({ success: false, error: 'Already requested' });
    nothingWritten();
  });

  it('creates the audiobook row from the Audible cache when the database has none', async () => {
    prismaMock.audibleCache.findUnique.mockResolvedValue({ asin: 'B0CACHE001', title: 'Cached Title', author: 'Cached Author', narrator: 'N', coverArtUrl: 'http://img/c.jpg' });

    const res = await post([item('B0CACHE001')]);

    expect(res.body.results[0]).toMatchObject({ success: true, requestId: 'req-new' });
    expect(prismaMock.audiobook.create).toHaveBeenCalledWith({
      data: { audibleAsin: 'B0CACHE001', title: 'Cached Title', author: 'Cached Author', narrator: 'N', coverArtUrl: 'http://img/c.jpg', status: 'pending' },
    });
    expect(audibleMock.getAudiobookDetails).not.toHaveBeenCalled();
  });

  it('still imports a row from the media folder (an admin may scan it; no server check)', async () => {
    const res = await post([item('B0BOOK0002', '/media/Author/Title B0BOOK0002')]);

    expect(res.body.results[0]).toMatchObject({ success: true });
    expect(jobQueueMock.addOrganizeJob).toHaveBeenCalledTimes(1);
  });
});
