/**
 * Component: Automatic re-request callers tests (#409)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * Shelf sync (processShelfBooks) and watched lists (processWatchedLists) run the
 * real createRequestForUser and the real rules in auto-rerequest.ts: a failed
 * request with no new block waits its backoff, a cancelled request is never
 * replaced, and the replacement carries the automatic retry count.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const txMock = createPrismaMock();
const quietLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: quietLogger, forJob: quietLogger } }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn().mockResolvedValue(null) }));
const audibleServiceMock = vi.hoisted(() => ({ getAudiobookDetails: vi.fn(), searchByAuthorAsin: vi.fn() }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => audibleServiceMock }));
vi.mock('@/lib/integrations/audible-series', () => ({ scrapeSeriesPage: vi.fn() }));
const jobQueue = vi.hoisted(() => ({ addSearchJob: vi.fn(), addNotificationJob: vi.fn() }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueue }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: vi.fn(async () => null) }) }));
vi.mock('@/lib/services/works.service', () => ({
  getSiblingAsins: vi.fn(async () => new Map()),
  seedAsin: vi.fn(async () => undefined),
  persistDedupGroups: vi.fn(async () => undefined),
}));

const { processShelfBooks, createEmptyStats } = await import('@/lib/services/shelf-sync-core.service');
const { processWatchedLists } = await import('@/lib/services/watched-lists.service');
const jobLogger = () => quietLogger() as unknown as Parameters<typeof processWatchedLists>[0] & Parameters<typeof processShelfBooks>[5];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const USER = 'user-1';
const BOOK = { asin: 'B00TEST409', title: 'Failing Book', author: 'Author' };

/** The user's own request for the book; the other request lookups find nothing. */
function ownRequest(own: Record<string, unknown>) {
  prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (where.userId ? own : null));
}

function failedRequest(overrides: Record<string, unknown> = {}) {
  const updatedAt = new Date(Date.now() - 23 * HOUR);
  return {
    id: 'req-old', userId: USER, audiobookId: 'book-1', type: 'audiobook', status: 'failed', customSearchTerms: null,
    createdAt: new Date(updatedAt.getTime() - HOUR), updatedAt, autoRerequestCount: 0, deletedAt: null, ...overrides,
  };
}

const callers = {
  'shelf sync': async () => {
    await processShelfBooks('goodreads', [{ bookId: 'gr-1', title: BOOK.title, author: BOOK.author }], USER, 'shelf-1', createEmptyStats(), jobLogger(), 10);
  },
  'watched author': async () => {
    const run = processWatchedLists(jobLogger(), { authorAsin: 'AUTHOR1' });
    await vi.runAllTimersAsync(); // the rate-limit delay between authors
    await run;
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));
  txMock.request.create.mockResolvedValue({ id: 'req-new', audiobook: { id: 'book-1' }, user: { id: USER } });
  txMock.blockedRelease.updateMany.mockResolvedValue({ count: 0 });
  txMock.request.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.blockedRelease.count.mockResolvedValue(0);
  prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'book-1', audibleAsin: BOOK.asin, title: BOOK.title, author: BOOK.author, narrator: null, coverArtUrl: null });
  prismaMock.ignoredAudiobook.findUnique.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue({ role: 'user', autoApproveRequests: true, plexUsername: 'u' });
  audibleServiceMock.getAudiobookDetails.mockResolvedValue(null);
  jobQueue.addSearchJob.mockResolvedValue(undefined);
  jobQueue.addNotificationJob.mockResolvedValue(undefined);
  // Shelf sync: the shelf book is already matched to the ASIN
  prismaMock.bookMapping.findUnique.mockResolvedValue({ id: 'map-1', audibleAsin: BOOK.asin, title: BOOK.title, author: BOOK.author, coverUrl: null, noMatch: false });
  prismaMock.bookMapping.findMany.mockResolvedValue([]);
  // Watched lists: one user watching one author with this one book, nothing owned
  prismaMock.watchedSeries.findMany.mockResolvedValue([]);
  prismaMock.watchedAuthor.findMany.mockResolvedValue([{ id: 'wa-1', authorAsin: 'AUTHOR1', authorName: BOOK.author, user: { id: USER, plexUsername: 'u' } }]);
  prismaMock.watchedAuthor.update.mockResolvedValue({});
  prismaMock.plexLibrary.findMany.mockResolvedValue([]);
  audibleServiceMock.searchByAuthorAsin.mockResolvedValue({ books: [{ ...BOOK }], hasMore: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(Object.entries(callers))('%s (automatic caller)', (_name, runCaller) => {
  it('leaves a failed request with no new block alone until its wait is over (23 h of 24)', async () => {
    ownRequest(failedRequest());

    await runCaller();

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.request.create).not.toHaveBeenCalled();
    expect(jobQueue.addSearchJob).not.toHaveBeenCalled();
  });

  it('replaces it once the wait is over, starting the new request at automatic retry 1', async () => {
    ownRequest(failedRequest({ updatedAt: new Date(Date.now() - 25 * HOUR), createdAt: new Date(Date.now() - 26 * HOUR) }));

    await runCaller();

    expect(txMock.request.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: USER, status: 'pending', autoRerequestCount: 1 }),
    }));
    expect(txMock.request.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'req-old' }) }));
    expect(jobQueue.addSearchJob).toHaveBeenCalledWith('req-new', expect.anything());
  });

  it('carries the count: after 3 automatic retries it waits 14 days, then starts retry 4', async () => {
    ownRequest(failedRequest({ autoRerequestCount: 3, updatedAt: new Date(Date.now() - 13 * DAY) }));
    await runCaller();
    expect(txMock.request.create).not.toHaveBeenCalled();

    ownRequest(failedRequest({ autoRerequestCount: 3, updatedAt: new Date(Date.now() - 15 * DAY), createdAt: new Date(Date.now() - 16 * DAY) }));
    await runCaller();
    expect(txMock.request.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ autoRerequestCount: 4 }),
    }));
  });

  it('never replaces a cancelled request, even 400 days later', async () => {
    ownRequest(failedRequest({ status: 'cancelled', updatedAt: new Date(Date.now() - 400 * DAY), createdAt: new Date(Date.now() - 401 * DAY) }));

    await runCaller();

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(jobQueue.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueue.addNotificationJob).not.toHaveBeenCalled();
  });
});
