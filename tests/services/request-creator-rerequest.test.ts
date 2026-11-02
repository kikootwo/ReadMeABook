/**
 * Component: Request Creator Re-request Tests (#312: the blocklist survives a re-request)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * createRequestForUser (the user's re-request; shelf sync and watched lists as #409 allows) replaces a
 * failed/warn/cancelled request atomically: reads and early returns first, then one
 * transaction (create, move blocklist, guarded delete), then jobs and notifications.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const txMock = createPrismaMock();
const txState = vi.hoisted(() => ({ outcome: 'none' as 'none' | 'committed' | 'rolled back' }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: () => log } }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn().mockResolvedValue(null) }));
const audibleServiceMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn() }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audibleServiceMock }));
const jobQueue = vi.hoisted(() => ({ addSearchJob: vi.fn(), addNotificationJob: vi.fn() }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueue }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: vi.fn(async () => null) }) }));
vi.mock('@/lib/services/works.service', () => ({
  getSiblingAsins: vi.fn(async () => new Map()),
  seedAsin: vi.fn(async () => undefined),
}));

const { createRequestForUser } = await import('@/lib/services/request-creator.service');

const BOOK = { asin: 'B00TEST312', title: 'Dead Release Book', author: 'Author' };
const USER = 'user-1';

/** Route the three request.findFirst lookups (active/available, the user's own, anyone's active). */
function requests(own: Record<string, unknown> | null, anyActive: Record<string, unknown> | null = null) {
  prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: Record<string, any> }) => {
    if (where.userId) return own;
    if (where.audiobookId && where.status?.notIn) return anyActive;
    return null; // downloaded/available check
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  txState.outcome = 'none';
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    try {
      const result = await fn(txMock);
      txState.outcome = 'committed';
      return result;
    } catch (error) {
      txState.outcome = 'rolled back';
      throw error;
    }
  });
  audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
  jobQueue.addSearchJob.mockResolvedValue(undefined);
  jobQueue.addNotificationJob.mockResolvedValue(undefined);
  prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'book-1', audibleAsin: BOOK.asin, title: BOOK.title, author: BOOK.author, narrator: null });
  prismaMock.ignoredAudiobook.findUnique.mockResolvedValue(null);
  prismaMock.ignoredAudiobook.findFirst.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue({ role: 'user', autoApproveRequests: true, plexUsername: 'u' });
  txMock.request.create.mockResolvedValue({ id: 'req-new', audiobook: { id: 'book-1' }, user: { id: USER } });
  txMock.blockedRelease.updateMany.mockResolvedValue({ count: 1 });
  txMock.request.deleteMany.mockResolvedValue({ count: 1 });
});

describe('createRequestForUser re-request (#312)', () => {
  it.each(['failed', 'warn', 'cancelled'])('replaces a %s request in one transaction, carrying its blocklist and search terms', async (status) => {
    requests({ id: 'req-old', status, customSearchTerms: 'dead release book unabridged' });

    const result = await createRequestForUser(USER, BOOK);

    expect(result.success).toBe(true);
    expect(txMock.request.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: USER, audiobookId: 'book-1', status: 'pending', customSearchTerms: 'dead release book unabridged' }),
    }));
    expect(txMock.blockedRelease.updateMany).toHaveBeenCalledWith({ where: { requestId: 'req-old' }, data: { requestId: 'req-new' } });
    expect(txMock.request.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'req-old' }) }));
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
    expect(txState.outcome).toBe('committed');
    // Jobs and notifications only after commit
    expect(jobQueue.addSearchJob).toHaveBeenCalledWith('req-new', expect.anything());
    expect(jobQueue.addSearchJob.mock.invocationCallOrder[0]).toBeGreaterThan(prismaMock.$transaction.mock.invocationCallOrder[0]);
  });

  it('does not touch the user\'s failed request when another user\'s request is being processed (returns being_processed)', async () => {
    requests({ id: 'req-old', status: 'failed' }, { id: 'req-other', userId: 'user-2', status: 'downloading' });

    const result = await createRequestForUser(USER, BOOK);

    expect(result).toMatchObject({ success: false, reason: 'being_processed' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.request.delete).not.toHaveBeenCalled();
    expect(prismaMock.request.deleteMany).not.toHaveBeenCalled();
  });

  it('returns duplicate, creates nothing and queues nothing when the old request was already replaced', async () => {
    requests({ id: 'req-old', status: 'failed' });
    txMock.request.deleteMany.mockResolvedValue({ count: 0 });

    const result = await createRequestForUser(USER, BOOK);

    expect(result).toMatchObject({ success: false, reason: 'duplicate' });
    expect(txState.outcome).toBe('rolled back');
    expect(jobQueue.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueue.addNotificationJob).not.toHaveBeenCalled();
  });

  it('a first request (nothing to replace) is a plain create', async () => {
    requests(null);
    prismaMock.request.create.mockResolvedValue({ id: 'req-first', audiobook: { id: 'book-1' }, user: { id: USER } });

    const result = await createRequestForUser(USER, BOOK);

    expect(result.success).toBe(true);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.request.create).toHaveBeenCalled();
  });

  it('an in-progress request is still a duplicate (no replace)', async () => {
    requests({ id: 'req-old', status: 'awaiting_search' });

    expect(await createRequestForUser(USER, BOOK)).toMatchObject({ success: false, reason: 'duplicate' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // #409: the user's own request ignores the automatic backoff and the cancelled rule, and resets the count
  it.each([
    ['failed', {}], ['warn', {}], ['cancelled', {}],
    ['failed', { bypassIgnore: true }], ['cancelled', { bypassIgnore: true }],
  ])('a user request replaces a %s request at once, even mid-backoff, and starts the count at 0 (%o)', async (status, options) => {
    requests({ id: 'req-old', status, customSearchTerms: null, createdAt: new Date(), updatedAt: new Date(), autoRerequestCount: 4 });

    const result = await createRequestForUser(USER, BOOK, options);

    expect(result.success).toBe(true);
    expect(txState.outcome).toBe('committed');
    expect(prismaMock.blockedRelease.count).not.toHaveBeenCalled();
    expect(txMock.request.create.mock.calls[0][0].data).not.toHaveProperty('autoRerequestCount');
  });

  it.each([
    ['cancelled', 'cancelled_by_user'],
    ['failed', 'retry_not_due'],
  ])('an automatic caller skips a %s request (%s): no transaction, no job, no notification', async (status, reason) => {
    requests({ id: 'req-old', status, customSearchTerms: null, createdAt: new Date(), updatedAt: new Date(), autoRerequestCount: 0 });
    prismaMock.blockedRelease.count.mockResolvedValue(0);

    const result = await createRequestForUser(USER, BOOK, { automatic: true });

    expect(result).toMatchObject({ success: false, reason });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(jobQueue.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueue.addNotificationJob).not.toHaveBeenCalled();
  });

  describe('automatic re-request info line', () => {
    const dueFailed = () => ({
      id: 'req-old', status: 'failed', customSearchTerms: null,
      createdAt: new Date(Date.now() - 3 * 86_400_000), updatedAt: new Date(Date.now() - 2 * 86_400_000), autoRerequestCount: 0,
    });
    const autoInfoLines = () => log.info.mock.calls.filter(([line]) => String(line).includes('automatically'));

    it('logs exactly one info line when the automatic replace is created', async () => {
      requests(dueFailed());
      prismaMock.blockedRelease.count.mockResolvedValue(0);

      expect((await createRequestForUser(USER, BOOK, { automatic: true })).success).toBe(true);

      expect(autoInfoLines()).toEqual([[
        'Re-requested failed request req-old ("Dead Release Book") automatically (retry 1); ' +
        'if it fails again with no new block, the next automatic retry waits 3 days (new request req-new)',
      ]]);
    });

    it('logs no info line when the retry is due but another user\'s request is being processed', async () => {
      requests(dueFailed(), { id: 'req-other', userId: 'user-2', status: 'downloading' });
      prismaMock.blockedRelease.count.mockResolvedValue(0);

      expect(await createRequestForUser(USER, BOOK, { automatic: true })).toMatchObject({ success: false, reason: 'being_processed' });

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(autoInfoLines()).toEqual([]);
    });

    it('logs no info line when another caller replaced the request first', async () => {
      requests(dueFailed());
      prismaMock.blockedRelease.count.mockResolvedValue(0);
      txMock.request.deleteMany.mockResolvedValue({ count: 0 });

      expect(await createRequestForUser(USER, BOOK, { automatic: true })).toMatchObject({ success: false, reason: 'duplicate' });

      expect(autoInfoLines()).toEqual([]);
    });
  });
});
