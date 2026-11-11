/**
 * Component: Library access requests, eligibility, search states and the grant
 * Documentation: documentation/features/requester-tags.md
 *
 * Real: library-access.service. Mocked: prisma, config, the ASIN matcher, the job queue, the tag
 * map and the item-mark step (requester-tags), so the grant's hand-off to #232's step is checked
 * without Audiobookshelf.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
const config = vi.hoisted(() => ({ values: {} as Record<string, string | null> }));
const findPlexMatch = vi.hoisted(() => vi.fn());
const jobQueue = vi.hoisted(() => ({ addNotificationJob: vi.fn() }));
const applyItemMarks = vi.hoisted(() => vi.fn());
const tagByUser = vi.hoisted(() => new Map<string, string>());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: async (key: string) => config.values[key] ?? null }) }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueue }));
vi.mock('@/lib/services/audiobookshelf/requester-tags', () => ({
  applyItemMarks,
  isRequesterTaggingOn: async () => config.values['audiobookshelf.tag_requester'] === 'true',
}));
vi.mock('@/lib/services/audiobookshelf/explicit-flag', () => ({ isExplicitMarkOn: async () => false }));
vi.mock('@/lib/services/audiobookshelf/requester-tag-users', () => ({ loadRequesterTagMap: async () => ({ tagByUser }) }));

const { accessRequestRefusal, grantLibraryAccess, libraryAccessStates } = await import('@/lib/services/library-access.service');

const USER = 'user-2';
const ASIN = 'B0ACCESS01';

function abs(tagging = true) {
  config.values = { 'system.backend_mode': 'audiobookshelf', 'audiobookshelf.tag_requester': tagging ? 'true' : 'false' };
}

beforeEach(() => {
  vi.clearAllMocks();
  abs();
  tagByUser.clear();
  tagByUser.set(USER, 'req:reader');
  prismaMock.user.findUnique.mockResolvedValue({ role: 'user' });
  prismaMock.request.findFirst.mockResolvedValue(null);
  jobQueue.addNotificationJob.mockResolvedValue(undefined);
  applyItemMarks.mockResolvedValue({});
});

describe('accessRequestRefusal', () => {
  it('null (create an access request) for a non-admin with a tag of their own', async () => {
    expect(await accessRequestRefusal(USER, ASIN)).toBeNull();
  });

  it.each([
    ['Plex backend', () => { config.values['system.backend_mode'] = 'plex'; }],
    ['tagging off', () => abs(false)],
    ['an admin', () => prismaMock.user.findUnique.mockResolvedValue({ role: 'admin' })],
    ['an unknown user', () => prismaMock.user.findUnique.mockResolvedValue(null)],
  ])('already_available for %s', async (_label, setup) => {
    setup();
    expect((await accessRequestRefusal(USER, ASIN))?.reason).toBe('already_available');
  });

  it('already_available when the user has their own available request', async () => {
    prismaMock.request.findFirst.mockResolvedValue({ id: 'own' });
    expect((await accessRequestRefusal(USER, ASIN))?.reason).toBe('already_available');
    expect(prismaMock.request.findFirst.mock.calls[0][0].where).toMatchObject({ userId: USER, status: 'available', audiobook: { audibleAsin: ASIN } });
  });

  it('access_unavailable when the name gives no tag of its own (shared, empty or not approved)', async () => {
    tagByUser.clear();
    const refusal = await accessRequestRefusal(USER, ASIN);
    expect(refusal?.reason).toBe('access_unavailable');
    expect(refusal?.message).toMatch(/Ask an admin/);
  });
});

describe('libraryAccessStates', () => {
  it('maps the caller\'s own latest request per book', async () => {
    prismaMock.request.findMany.mockResolvedValue([
      { status: 'awaiting_approval', accessRequest: true, audiobook: { audibleAsin: 'A1' } },
      { status: 'denied', accessRequest: true, audiobook: { audibleAsin: 'A2' } },
      { status: 'available', accessRequest: false, audiobook: { audibleAsin: 'A3' } },
      { status: 'cancelled', accessRequest: true, audiobook: { audibleAsin: 'A4' } },
      { status: 'available', accessRequest: true, audiobook: { audibleAsin: 'A5' } },
      { status: 'denied', accessRequest: true, audiobook: { audibleAsin: 'A5' } }, // older
    ]);

    const states = await libraryAccessStates(USER, ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);

    expect(Object.fromEntries(states)).toEqual({ A1: 'requested', A2: 'denied', A4: 'request', A6: 'request' });
  });

  it('empty when access requests don\'t apply (admin), with no request read', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'admin' });
    expect((await libraryAccessStates(USER, ['A1'])).size).toBe(0);
    expect(prismaMock.request.findMany).not.toHaveBeenCalled();
  });

  it('empty for no books, and never throws', async () => {
    expect((await libraryAccessStates(USER, [])).size).toBe(0);
    prismaMock.request.findMany.mockRejectedValue(new Error('db down'));
    expect((await libraryAccessStates(USER, ['A1'])).size).toBe(0);
  });
});

describe('grantLibraryAccess', () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    id: 'req-access', userId: USER, status: 'awaiting_approval', accessRequest: true,
    audiobook: { id: 'book-1', audibleAsin: ASIN, title: 'Shared Book', author: 'Author', narrator: null, absItemId: null, plexGuid: null },
    user: { id: USER, plexUsername: 'reader' },
    ...over,
  });

  beforeEach(() => {
    prismaMock.request.findFirst.mockResolvedValue(stored());
    prismaMock.request.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.audiobook.update.mockResolvedValue({});
    findPlexMatch.mockResolvedValue({ plexGuid: 'li_123', title: 'Shared Book' });
  });

  it('completes it, fills the item id, notifies and tags this book', async () => {
    const result = await grantLibraryAccess('req-access');

    expect(result.granted).toBe(true);
    const cas = prismaMock.request.updateMany.mock.calls[0][0];
    expect(cas.where).toEqual({ id: 'req-access', status: 'awaiting_approval', deletedAt: null });
    expect(cas.data).toMatchObject({ status: 'available', approvalBypassedBy: null });
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith({ where: { id: 'book-1' }, data: { absItemId: 'li_123' } });
    expect(jobQueue.addNotificationJob).toHaveBeenCalledWith('request_available', 'req-access', 'Shared Book', 'Author', 'reader', undefined, 'audiobook');
    expect(applyItemMarks).toHaveBeenCalledWith(expect.objectContaining({ deliveredBookIds: ['book-1'], listedItems: [], tagging: true }));
    if (result.granted) expect(result.request).toMatchObject({ status: 'available' });
  });

  it('keeps an item id already on the book', async () => {
    prismaMock.request.findFirst.mockResolvedValue(stored({ audiobook: { ...stored().audiobook, absItemId: 'li_old' } }));
    await grantLibraryAccess('req-access');
    expect(prismaMock.audiobook.update).not.toHaveBeenCalled();
  });

  it('not_in_library when the book left the library: nothing written', async () => {
    findPlexMatch.mockResolvedValue(null);
    expect(await grantLibraryAccess('req-access')).toEqual({ granted: false, reason: 'not_in_library' });
    expect(prismaMock.request.updateMany).not.toHaveBeenCalled();
  });

  it('changed when it is no longer an access request awaiting approval, or another call won', async () => {
    prismaMock.request.findFirst.mockResolvedValue(null);
    expect(await grantLibraryAccess('req-access')).toEqual({ granted: false, reason: 'changed' });

    prismaMock.request.findFirst.mockResolvedValue(stored());
    prismaMock.request.updateMany.mockResolvedValue({ count: 0 });
    expect(await grantLibraryAccess('req-access')).toEqual({ granted: false, reason: 'changed' });
    expect(jobQueue.addNotificationJob).not.toHaveBeenCalled();
    expect(applyItemMarks).not.toHaveBeenCalled();
  });

  it('a failed tag step never undoes the grant', async () => {
    applyItemMarks.mockRejectedValue(new Error('ABS down'));
    expect((await grantLibraryAccess('req-access')).granted).toBe(true);
  });

  it('Plex backend: fills plexGuid, no tag step', async () => {
    config.values['system.backend_mode'] = 'plex';
    await grantLibraryAccess('req-access');
    expect(prismaMock.audiobook.update).toHaveBeenCalledWith({ where: { id: 'book-1' }, data: { plexGuid: 'li_123' } });
    expect(applyItemMarks).not.toHaveBeenCalled();
  });
});
