/**
 * Component: Request Creator, access requests for a book already in the library
 * Documentation: documentation/features/requester-tags.md
 *
 * A manual request for a book in the library (another user's available request, or a library
 * match) becomes an access request when library-access allows it: `accessRequest: true`, no
 * search, waits for approval or is granted at once when auto-approved. Automatic callers and
 * refusals keep the old answer. Real: request-creator. Mocked: prisma, matcher, Audnexus, job
 * queue, the library-access decisions.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const txMock = createPrismaMock();

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));
const findPlexMatch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch }));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => ({ getAudiobookDetails: vi.fn(async () => null) }) }));
const jobQueue = vi.hoisted(() => ({ addSearchJob: vi.fn(), addNotificationJob: vi.fn() }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueue }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: vi.fn(async () => null) }) }));
vi.mock('@/lib/services/works.service', () => ({ getSiblingAsins: vi.fn(async () => new Map()), seedAsin: vi.fn(async () => undefined) }));
const access = vi.hoisted(() => ({ accessRequestRefusal: vi.fn(), grantLibraryAccess: vi.fn() }));
vi.mock('@/lib/services/library-access.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/library-access.service')>()),
  ...access,
}));

const { createRequestForUser } = await import('@/lib/services/request-creator.service');

const BOOK = { asin: 'B0ACCESS01', title: 'Shared Book', author: 'Author' };
const USER = 'user-2';
const FIRST_AVAILABLE = { id: 'req-first', userId: 'user-1', status: 'available' };

/** findFirst: the active-request check answers `active`; every other check finds nothing (unless `other`). */
function requests(active: unknown, other: unknown = null) {
  prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: { status?: { in?: string[]; notIn?: string[] }; userId?: string } }) => {
    if (where.status?.in) return active;
    if (where.status?.notIn) return other;
    return null;
  });
}

const created = () => prismaMock.request.create.mock.calls[0]?.[0]?.data;

beforeEach(() => {
  vi.clearAllMocks();
  requests(FIRST_AVAILABLE);
  findPlexMatch.mockResolvedValue(null);
  access.accessRequestRefusal.mockResolvedValue(null);
  access.grantLibraryAccess.mockResolvedValue({ granted: true, request: { id: 'req-new', status: 'available' } });
  jobQueue.addNotificationJob.mockResolvedValue(undefined);
  prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'book-1', audibleAsin: BOOK.asin, title: BOOK.title, author: BOOK.author, narrator: null });
  prismaMock.user.findUnique.mockResolvedValue({ role: 'user', autoApproveRequests: false, plexUsername: 'reader' });
  prismaMock.request.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'req-new', ...data }));
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));
});

describe('access requests (book already in the library)', () => {
  it('needs approval: created awaiting approval as an access request, pending notification, no search', async () => {
    const result = await createRequestForUser(USER, BOOK);

    expect(result.success).toBe(true);
    expect(created()).toMatchObject({ status: 'awaiting_approval', accessRequest: true, userId: USER });
    expect(access.grantLibraryAccess).not.toHaveBeenCalled();
    expect(jobQueue.addSearchJob).not.toHaveBeenCalled();
    expect(jobQueue.addNotificationJob).toHaveBeenCalledWith('request_pending_approval', 'req-new', BOOK.title, BOOK.author, 'reader');
  });

  it('auto-approved: granted at once, no pending or approved notification, no search', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'user', autoApproveRequests: true, plexUsername: 'reader' });

    const result = await createRequestForUser(USER, BOOK);

    expect(created()).toMatchObject({ status: 'awaiting_approval', accessRequest: true });
    expect(access.grantLibraryAccess).toHaveBeenCalledWith('req-new', expect.anything());
    expect(result).toEqual({ success: true, request: { id: 'req-new', status: 'available' } });
    expect(jobQueue.addNotificationJob).not.toHaveBeenCalled();
    expect(jobQueue.addSearchJob).not.toHaveBeenCalled();
  });

  it('an admin: always auto-approved, so granted at once', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'admin', autoApproveRequests: false, plexUsername: 'admin' });

    const result = await createRequestForUser(USER, BOOK);

    expect(created()).toMatchObject({ accessRequest: true });
    expect(access.grantLibraryAccess).toHaveBeenCalledWith('req-new', expect.anything());
    expect(result).toEqual({ success: true, request: { id: 'req-new', status: 'available' } });
    expect(jobQueue.addSearchJob).not.toHaveBeenCalled();
  });

  it('auto-approved but the grant failed (left the library): stays waiting, admin notified', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'user', autoApproveRequests: true, plexUsername: 'reader' });
    access.grantLibraryAccess.mockResolvedValue({ granted: false, reason: 'not_in_library' });

    const result = await createRequestForUser(USER, BOOK);

    expect(result.success).toBe(true);
    expect(jobQueue.addNotificationJob).toHaveBeenCalledWith('request_pending_approval', 'req-new', BOOK.title, BOOK.author, 'reader');
    expect(jobQueue.addSearchJob).not.toHaveBeenCalled();
  });

  it('a library match (no request) also becomes an access request', async () => {
    requests(null);
    findPlexMatch.mockResolvedValue({ plexGuid: 'li_1', title: BOOK.title });

    await createRequestForUser(USER, BOOK);

    expect(access.accessRequestRefusal).toHaveBeenCalledWith(USER, BOOK.asin);
    expect(created()).toMatchObject({ accessRequest: true });
  });

  it('another user\'s request awaiting approval does not block an access request', async () => {
    requests(FIRST_AVAILABLE, { id: 'req-other', userId: 'user-3', status: 'awaiting_approval', accessRequest: true });

    const result = await createRequestForUser(USER, BOOK);

    expect(result.success).toBe(true);
  });

  it('a refusal from library-access is returned unchanged; nothing created', async () => {
    const refusal = { success: false, reason: 'access_unavailable', message: 'no tag' };
    access.accessRequestRefusal.mockResolvedValue(refusal);

    expect(await createRequestForUser(USER, BOOK)).toEqual(refusal);
    expect(prismaMock.request.create).not.toHaveBeenCalled();
  });

  it('automatic callers (shelf sync, watched lists) are refused as before, without asking library-access', async () => {
    const result = await createRequestForUser(USER, BOOK, { automatic: true });

    expect(result).toMatchObject({ success: false, reason: 'already_available' });
    expect(access.accessRequestRefusal).not.toHaveBeenCalled();
  });

  it('a downloaded (not yet available) book is still "being processed"', async () => {
    requests({ ...FIRST_AVAILABLE, status: 'downloaded' });

    expect(await createRequestForUser(USER, BOOK)).toMatchObject({ success: false, reason: 'being_processed' });
    expect(access.accessRequestRefusal).not.toHaveBeenCalled();
  });

  it('a book not in the library is a normal request (no accessRequest field)', async () => {
    requests(null);
    prismaMock.user.findUnique.mockResolvedValue({ role: 'user', autoApproveRequests: true, plexUsername: 'reader' });

    await createRequestForUser(USER, BOOK);

    expect(created()).toMatchObject({ status: 'pending' });
    expect(created()).not.toHaveProperty('accessRequest');
    expect(jobQueue.addSearchJob).toHaveBeenCalled();
  });
});
