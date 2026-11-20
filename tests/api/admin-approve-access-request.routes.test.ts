/**
 * Component: Admin approve route, access requests (book already in the library)
 * Documentation: documentation/admin-features/request-approval.md
 *
 * Approving an access request grants it (library-access) with no search or download. One that is
 * no longer awaiting approval answers 400 InvalidStatus (bulk approve counts it as skipped). If the
 * book left the library, or the admin picked a release, the flag is cleared and it is approved as a
 * normal request.
 * Deny is unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const jobQueueMock = vi.hoisted(() => ({
  addSearchJob: vi.fn(),
  addSearchEbookJob: vi.fn(),
  addDownloadJob: vi.fn(),
  addStartDirectDownloadJob: vi.fn(),
  addNotificationJob: vi.fn(),
}));
const grantLibraryAccess = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) =>
    handler({ user: { id: 'admin-1', sub: 'admin-1', role: 'admin' } }),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: vi.fn(async () => null) }) }));
vi.mock('@/lib/services/library-access.service', () => ({ grantLibraryAccess }));

const ROW = {
  id: 'req-access',
  status: 'awaiting_approval',
  type: 'audiobook',
  userId: 'user-2',
  releaseDate: null,
  selectedTorrent: null,
  accessRequest: true,
  audiobook: { id: 'ab-1', title: 'Shared Book', author: 'Author', audibleAsin: 'B0ACCESS01' },
  user: { id: 'user-2', plexUsername: 'reader' },
};

async function post(action: 'approve' | 'deny', row: Record<string, unknown> = ROW) {
  prismaMock.request.findFirst.mockResolvedValue(row);
  prismaMock.request.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }));
  const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
  const request = { json: vi.fn().mockResolvedValue({ action }) };
  const response = await POST(request as unknown as Parameters<typeof POST>[0], { params: Promise.resolve({ id: 'req-access' }) });
  return { status: response.status, body: await response.json() };
}

describe('POST /api/admin/requests/[id]/approve: access requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  });

  it('approve grants access: no search, no download, no approved notification', async () => {
    grantLibraryAccess.mockResolvedValue({ granted: true, request: { ...ROW, status: 'available', approvalBypassedBy: null } });

    const { status, body } = await post('approve');

    expect(status).toBe(200);
    expect(grantLibraryAccess).toHaveBeenCalledWith('req-access', expect.anything());
    expect(body.message).toBe('Access granted: the book is already in the library');
    expect(body.accessGranted).toBe(true); // the dashboard toast names the user and the book
    expect(body.request.status).toBe('available');
    expect(body.request).not.toHaveProperty('approvalBypassedBy');
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).not.toHaveBeenCalled();
    expect(prismaMock.request.update).not.toHaveBeenCalled();
  });

  it('no longer awaiting approval (another call won): 400 InvalidStatus', async () => {
    grantLibraryAccess.mockResolvedValue({ granted: false, reason: 'changed' });

    const { status, body } = await post('approve');

    expect(status).toBe(400);
    expect(body.error).toBe('InvalidStatus');
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it('book left the library: flag cleared, approved as a normal request with a search', async () => {
    grantLibraryAccess.mockResolvedValue({ granted: false, reason: 'not_in_library' });

    const { status, body } = await post('approve');

    expect(status).toBe(200);
    expect(prismaMock.request.update.mock.calls[0][0]).toEqual({ where: { id: 'req-access' }, data: { accessRequest: false } });
    expect(prismaMock.request.update.mock.calls[1][0].data.status).toBe('pending');
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
    expect(body.message).toBe('Request approved and search job triggered');
  });

  it('an admin-picked release: flag cleared, the pick downloads (no grant)', async () => {
    const PICK = { guid: 'g-1', title: 'Release', indexer: 'Idx', downloadUrl: 'magnet:?xt=urn:btih:abc' };
    prismaMock.request.findFirst.mockResolvedValue(ROW);
    prismaMock.request.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...ROW, ...data }));
    const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
    const request = { json: vi.fn().mockResolvedValue({ action: 'approve', selectedTorrent: PICK }) };
    const response = await POST(request as unknown as Parameters<typeof POST>[0], { params: Promise.resolve({ id: 'req-access' }) });

    expect(grantLibraryAccess).not.toHaveBeenCalled();
    expect(prismaMock.request.update.mock.calls[0][0]).toEqual({ where: { id: 'req-access' }, data: { accessRequest: false } });
    // The pick then goes through the normal approve path (guard → download, or a 4xx for an unusable pick)
    expect(response.status).not.toBe(500);
  });

  it('deny is the normal deny (no grant)', async () => {
    const { status, body } = await post('deny');

    expect(status).toBe(200);
    expect(body.message).toBe('Request denied');
    expect(grantLibraryAccess).not.toHaveBeenCalled();
  });

  it('a normal request never goes through the grant', async () => {
    await post('approve', { ...ROW, accessRequest: false });

    expect(grantLibraryAccess).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
  });
});
