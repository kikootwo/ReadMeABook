/**
 * Component: Request Creator, book removed from the library (#214)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * A request the library scan failed as "Removed from library" can be requested
 * again by hand (its owner or another user), but no automatic caller (shelf
 * sync, watched authors/series) brings the book back on its own, for any user.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const txMock = createPrismaMock();

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

const BOOK = { asin: 'B00TEST214', title: 'Deleted Book', author: 'Author' };
const OWNER = 'user-owner';
const OTHER = 'user-other';
const LONG_AGO = new Date(Date.now() - 400 * 86_400_000); // every automatic backoff has passed

/** The owner's request, failed by the library scan after the book left the library. */
const REMOVED = {
  id: 'req-removed', userId: OWNER, audiobookId: 'book-1', type: 'audiobook', status: 'failed',
  errorMessage: 'Removed from library. Request it again to download it.',
  customSearchTerms: null, createdAt: LONG_AGO, updatedAt: LONG_AGO, autoRerequestCount: 0, deletedAt: null,
};

/** The findFirst filters createRequestForUser uses. */
interface RequestWhere {
  userId?: string;
  audiobookId?: string;
  audiobook?: { audibleAsin?: string };
  type?: string;
  errorMessage?: string;
  status?: string | { in?: string[]; notIn?: string[] };
}

/** A stand-in for the requests table holding only REMOVED: answers each findFirst by its where. */
function matchesRow(where: RequestWhere): boolean {
  if (where.userId && where.userId !== REMOVED.userId) return false;
  if (where.audiobookId && where.audiobookId !== REMOVED.audiobookId) return false;
  if (where.audiobook?.audibleAsin && where.audiobook.audibleAsin !== BOOK.asin) return false;
  if (where.type && where.type !== REMOVED.type) return false;
  if (where.errorMessage !== undefined && where.errorMessage !== REMOVED.errorMessage) return false;
  const status = where.status;
  if (typeof status === 'string') return status === REMOVED.status;
  if (status?.in) return status.in.includes(REMOVED.status);
  if (status?.notIn) return !status.notIn.includes(REMOVED.status);
  return true;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: RequestWhere }) => (matchesRow(where) ? REMOVED : null));
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));
  audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
  jobQueue.addSearchJob.mockResolvedValue(undefined);
  jobQueue.addNotificationJob.mockResolvedValue(undefined);
  prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'book-1', audibleAsin: BOOK.asin, title: BOOK.title, author: BOOK.author, narrator: null });
  prismaMock.ignoredAudiobook.findUnique.mockResolvedValue(null);
  prismaMock.ignoredAudiobook.findFirst.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue({ role: 'user', autoApproveRequests: true, plexUsername: 'u' });
  prismaMock.blockedRelease.count.mockResolvedValue(0);
  prismaMock.request.create.mockResolvedValue({ id: 'req-other-new', audiobook: { id: 'book-1' }, user: { id: OTHER } });
  txMock.request.create.mockResolvedValue({ id: 'req-owner-new', audiobook: { id: 'book-1' }, user: { id: OWNER } });
  txMock.blockedRelease.updateMany.mockResolvedValue({ count: 0 });
  txMock.request.deleteMany.mockResolvedValue({ count: 1 });
});

describe('re-request after "Removed from library" (#214)', () => {
  it('the owner requests it again: the failed request is replaced and a search is queued', async () => {
    const result = await createRequestForUser(OWNER, BOOK);

    expect(result.success).toBe(true);
    expect(txMock.request.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'req-removed' }) }));
    expect(jobQueue.addSearchJob).toHaveBeenCalledWith('req-owner-new', expect.anything());
  });

  it('another user requests it: a new request is created and a search is queued', async () => {
    const result = await createRequestForUser(OTHER, BOOK);

    expect(result.success).toBe(true);
    expect(prismaMock.request.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: OTHER }) }));
    expect(jobQueue.addSearchJob).toHaveBeenCalledWith('req-other-new', expect.anything());
  });

  it.each([
    ['the owner', OWNER],
    ['another user', OTHER],
  ])('an automatic caller for %s skips it (removed_from_library): nothing created, searched or notified', async (_who, userId) => {
    const result = await createRequestForUser(userId, BOOK, { automatic: true });

    expect(result).toMatchObject({ success: false, reason: 'removed_from_library' });
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(jobQueue.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueue.addNotificationJob).not.toHaveBeenCalled();
  });

  it('an automatic caller skips it even when a block was added during that attempt', async () => {
    prismaMock.blockedRelease.count.mockResolvedValue(2);

    expect(await createRequestForUser(OWNER, BOOK, { automatic: true })).toMatchObject({ success: false, reason: 'removed_from_library' });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
