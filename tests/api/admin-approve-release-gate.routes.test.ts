/**
 * Component: Admin Approve Release Gate Tests
 * Documentation: documentation/admin-features/request-approval.md
 *
 * Approving a request with no usable release pick applies the same release-date gate
 * as request creation: an unreleased audiobook (with "Skip unreleased books in automatic
 * searches" on) waits as `awaiting_release` and no search is queued (#556).
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
const configGet = vi.hoisted(() => vi.fn());
const guardTorrentSelection = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) =>
    handler({ user: { id: 'admin-1', sub: 'admin-1', role: 'admin' } }),
  requireAdmin: (_req: unknown, handler: () => unknown) => handler(),
}));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: configGet }) }));
vi.mock('@/lib/services/download-selection-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/download-selection-guard')>()),
  guardTorrentSelection,
}));

const FUTURE = new Date(Date.UTC(2099, 4, 5)); // May 5, 2099
const PAST = new Date(Date.UTC(2020, 0, 15));
const PICK = { guid: 'g-1', title: 'Release', indexer: 'Idx', downloadUrl: 'magnet:?xt=urn:btih:abc' };

function storedRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    status: 'awaiting_approval',
    type: 'audiobook',
    userId: 'user-1',
    releaseDate: FUTURE,
    selectedTorrent: null,
    audiobook: { id: 'ab-1', title: 'Future Book', author: 'Author', audibleAsin: 'B0FUTURE01' },
    user: { id: 'user-1', plexUsername: 'reader' },
    ...overrides,
  };
}

async function approve(row: ReturnType<typeof storedRequest>) {
  prismaMock.request.findFirst.mockResolvedValue(row);
  prismaMock.request.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }));
  const { POST } = await import('@/app/api/admin/requests/[id]/approve/route');
  const request = { json: vi.fn().mockResolvedValue({ action: 'approve' }) };
  const response = await POST(request as unknown as Parameters<typeof POST>[0], { params: Promise.resolve({ id: row.id }) });
  return { status: response.status, body: await response.json() };
}

const statusWritten = () => prismaMock.request.update.mock.calls[0]?.[0]?.data?.status;

describe('POST /api/admin/requests/[id]/approve: release-date gate (#556)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configGet.mockResolvedValue(null); // setting unset = on
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
  });

  it('unreleased + setting on: awaiting_release, no search, approved notification once', async () => {
    const { status, body } = await approve(storedRequest());

    expect(status).toBe(200);
    expect(statusWritten()).toBe('awaiting_release');
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addSearchEbookJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addDownloadJob).not.toHaveBeenCalled();
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledTimes(1);
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith(
      'request_approved', 'req-1', 'Future Book', 'Author', 'reader'
    );
    expect(body.awaitingRelease).toBe(true);
    expect(body.message).toBe('Request approved; it will be searched on its release date (May 5, 2099)');
    expect(body.request.status).toBe('awaiting_release');
    expect(prismaMock.request.update.mock.calls[0][0].data.approvalBypassedBy).toBeNull();
    expect(configGet).toHaveBeenCalledWith('indexer.skip_unreleased');
  });

  it('unreleased + setting explicitly "true": awaiting_release', async () => {
    configGet.mockResolvedValue('true');
    await approve(storedRequest());
    expect(statusWritten()).toBe('awaiting_release');
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
  });

  it('unreleased + setting off: pending and a search is queued', async () => {
    configGet.mockResolvedValue('false');
    const { body } = await approve(storedRequest());

    expect(statusWritten()).toBe('pending');
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledWith('req-1', expect.objectContaining({ id: 'ab-1' }));
    expect(body.awaitingRelease).toBeUndefined();
    expect(body.message).toBe('Request approved and search job triggered');
  });

  it('released book: pending and a search is queued', async () => {
    await approve(storedRequest({ releaseDate: PAST }));
    expect(statusWritten()).toBe('pending');
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
  });

  it('undated book: pending and a search is queued', async () => {
    await approve(storedRequest({ releaseDate: null }));
    expect(statusWritten()).toBe('pending');
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
  });

  it('setting read fails: searches as before (never waits on an error)', async () => {
    configGet.mockRejectedValue(new Error('db down'));
    await approve(storedRequest());
    expect(statusWritten()).toBe('pending');
    expect(jobQueueMock.addSearchJob).toHaveBeenCalledTimes(1);
  });

  it('stored user pick on an unreleased book: downloads it as today', async () => {
    guardTorrentSelection.mockResolvedValue({ ok: true, value: PICK });
    const { body } = await approve(storedRequest({ selectedTorrent: PICK }));

    expect(statusWritten()).toBe('downloading');
    expect(jobQueueMock.addDownloadJob).toHaveBeenCalledWith('req-1', expect.any(Object), PICK);
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(body.awaitingRelease).toBeUndefined();
  });

  it('unusable stored pick on an unreleased book: pick cleared, waits for release', async () => {
    guardTorrentSelection.mockResolvedValue({ ok: false, retryable: false, error: 'link expired' });
    const { body } = await approve(storedRequest({ selectedTorrent: PICK }));

    const data = prismaMock.request.update.mock.calls[0][0].data;
    expect(data.status).toBe('awaiting_release');
    expect(data).toHaveProperty('selectedTorrent');
    expect(jobQueueMock.addSearchJob).not.toHaveBeenCalled();
    expect(body.selectionDropped).toBe('link expired');
    expect(body.message).toBe(
      "The user's selected release could not be used (link expired). Request approved; it will be searched on its release date (May 5, 2099) instead."
    );
  });

  it('ebook request: searches now, as ebook requests never wait for release at creation', async () => {
    const { body } = await approve(storedRequest({ type: 'ebook' }));

    expect(statusWritten()).toBe('pending');
    expect(jobQueueMock.addSearchEbookJob).toHaveBeenCalledTimes(1);
    expect(body.awaitingRelease).toBeUndefined();
  });
});
