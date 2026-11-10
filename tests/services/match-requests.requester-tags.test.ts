/**
 * Component: Library scan step 6, requester tags after delivery (#232)
 * Documentation: documentation/features/requester-tags.md
 *
 * The delivery-steps block of matchRequestsToLibrary: the link or ASIN-match winner's requester is
 * tagged; a CAS loser, tagging off and Plex mode make no ABS call; a failing tag step leaves the
 * delivery and its notification alone; repair acts only on a listed tag list that lacks a tag,
 * capped at 25 items a run. Real: match-requests, request-library-link, requester-tags.
 * Mocked: prisma (in-memory holder), the ASIN matcher, the job queue, config, writeABSItem.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createLibraryDb, resetLibraryDb, wireLibraryDb, type Row } from '../helpers/library-link-db';
import type { RMABLogger } from '@/lib/utils/logger';
import type { LibraryItem } from '@/lib/services/library/ILibraryService';

const prismaMock = createPrismaMock();
const state = vi.hoisted(() => ({
  config: {} as Record<string, string>,
  tagCalls: [] as Array<{ itemId: string; tags?: string[]; explicit?: true }>,
  tagResult: (_itemId: string, want: { tags?: string[]; explicit?: true }): unknown =>
    ({ tags: want.tags ? 'added' : 'none', addedTags: want.tags ?? [], explicit: want.explicit ? 'set' : 'none' }),
}));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn() }));
const findPlexMatchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: findPlexMatchMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ get: async (key: string) => state.config[key] ?? null, clearCache: () => {} }),
}));
vi.mock('@/lib/services/audiobookshelf/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/audiobookshelf/api')>()),
  writeABSItem: async (itemId: string, want: { tags?: string[]; explicit?: true }) => {
    state.tagCalls.push({ itemId, ...want });
    return state.tagResult(itemId, want);
  },
  canKeyUserSeeExplicit: async () => true,
}));

const db = createLibraryDb();
const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
const MEDIA = '/media/audiobooks';
const FOLDER = 'Author/Delivered Book B0LINKED1';
const LINK_ITEM: LibraryItem = {
  id: 'abs-link', externalId: 'abs-link', title: 'Delivered Book', author: 'Author', asin: 'B0OTHER99',
  path: `/audiobooks/${FOLDER}`, isMissing: false, addedAt: new Date('2026-10-20T12:05:00Z'), updatedAt: new Date('2026-10-20T12:05:00Z'),
};

function user(id: string, plexUsername: string, over: Row = {}) {
  db.users.push({ id, plexUsername, deletedAt: null, registrationStatus: 'approved', ...over });
}

/** A book already in the library (absItemId set) with an available request. */
function available(reqId: string, bookId: string, userId: string, over: Row = {}) {
  if (!db.audiobooks.some((a) => a.id === bookId)) {
    db.audiobooks.push({ id: bookId, audibleAsin: `B0${bookId}`, title: `Book ${bookId}`, author: 'A', narrator: null, filePath: null, absItemId: `item-${bookId}` });
  }
  db.requests.push({ id: reqId, audiobookId: bookId, userId, type: 'audiobook', status: 'available', deletedAt: null, approvalBypassedBy: null, ...over });
}

/** A request the ASIN match completes this run (findPlexMatch returns item-<bookId>). */
function asinMatched(reqId: string, bookId: string, userId: string, status = 'pending') {
  db.audiobooks.push({ id: bookId, audibleAsin: `B0${bookId}`, title: `Book ${bookId}`, author: 'A', narrator: null, filePath: null, absItemId: null });
  db.requests.push({ id: reqId, audiobookId: bookId, userId, type: 'audiobook', status, deletedAt: null, approvalBypassedBy: null });
}

/** A `downloaded` request RMAB delivered to FOLDER, linked to LINK_ITEM this run. */
function linked(reqId: string, userId: string, over: Row = {}) {
  if (!db.audiobooks.some((a) => a.id === 'ab-link')) {
    db.plex.push({ id: 'row-link', plexGuid: 'abs-link', plexLibraryId: 'lib-1', filePath: LINK_ITEM.path, addedAt: LINK_ITEM.addedAt, asin: 'B0OTHER99' });
    db.audiobooks.push({
      id: 'ab-link', audibleAsin: 'B0LINKED1', title: 'Delivered Book', author: 'Author', narrator: null,
      filePath: `${MEDIA}/${FOLDER}`, filesHash: 'f'.repeat(64), status: 'completed', completedAt: new Date('2026-10-20T12:00:00Z'),
      plexGuid: null, absItemId: null,
    });
  }
  db.requests.push({
    id: reqId, audiobookId: 'ab-link', userId, type: 'audiobook', status: 'downloaded', deletedAt: null,
    completedAt: new Date('2026-10-20T12:00:00Z'), updatedAt: new Date('2026-10-20T12:00:00Z'), errorMessage: null, approvalBypassedBy: null, ...over,
  });
}

const listed = (itemId: string, tags?: string[]): LibraryItem => ({
  id: itemId, externalId: itemId, title: itemId, author: 'A', addedAt: new Date(), updatedAt: new Date(), ...(tags ? { tags } : {}),
});
const req = (id: string) => db.requests.find((r) => r.id === id) ?? {};

async function run(listedItems: LibraryItem[] = [], backendMode = 'audiobookshelf') {
  const { matchRequestsToLibrary } = await import('@/lib/services/library/match-requests');
  return matchRequestsToLibrary({ backendMode, libraryId: 'lib-1', listedItems, logger: logger as unknown as RMABLogger });
}

describe('requester tags after delivery (#232)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLibraryDb(db);
    wireLibraryDb(prismaMock, db, MEDIA);
    state.config = { 'audiobookshelf.tag_requester': 'true' };
    state.tagCalls = [];
    state.tagResult = (_itemId, want) => ({ tags: want.tags ? 'added' : 'none', addedTags: want.tags ?? [], explicit: want.explicit ? 'set' : 'none' });
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    findPlexMatchMock.mockImplementation(async ({ asin }: { asin: string }) =>
      (asin.startsWith('B0asin') ? { plexGuid: `item-${asin.slice(2)}`, title: 'Matched' } : null));
    user('u-alice', 'alice');
    user('u-bob', 'Bob');
  });

  it('an ASIN-match win tags its requester', async () => {
    asinMatched('r1', 'asin1', 'u-alice');

    const result = await run();

    expect(result.matched).toBe(1);
    expect(state.tagCalls).toEqual([{ itemId: 'item-asin1', tags: ['req:alice'] }]);
    expect(logger.info).toHaveBeenCalledWith('Tagged "Book asin1" (Audiobookshelf item item-asin1) with req:alice');
  });

  it('a library-link win tags its requester (listing without tags: a delivered book may still read)', async () => {
    linked('r1', 'u-alice');

    const result = await run([{ ...LINK_ITEM }]);

    expect(result.linkedByPath).toBe(1);
    expect(req('r1').status).toBe('available');
    expect(state.tagCalls).toEqual([{ itemId: 'abs-link', tags: ['req:alice'] }]);
  });

  it('a CAS loser makes no ABS call', async () => {
    asinMatched('r1', 'asin1', 'u-alice');
    db.afterRead = () => {
      Object.assign(req('r1'), { status: 'available' }); // another job completed it
      Object.assign(db.audiobooks[0], { absItemId: 'item-asin1' });
    };

    const result = await run();

    expect(result.matched).toBe(0);
    expect(state.tagCalls).toEqual([]);
  });

  it('tagging off: no users query, no ABS call', async () => {
    state.config = {};
    asinMatched('r1', 'asin1', 'u-alice');

    await run([listed('item-x', [])]);

    expect(state.tagCalls).toEqual([]);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('Plex mode: no ABS call', async () => {
    asinMatched('r1', 'asin1', 'u-alice');

    await run([], 'plex');

    expect(state.tagCalls).toEqual([]);
  });

  it('a tag step that throws leaves the delivery and its notification intact', async () => {
    asinMatched('r1', 'asin1', 'u-alice');
    prismaMock.user.findMany.mockRejectedValue(new Error('db down'));

    const result = await run();

    expect(result.matched).toBe(1);
    expect(req('r1').status).toBe('available');
    expect(jobQueueMock.addNotificationJob).toHaveBeenCalledWith('request_available', 'r1', 'Book asin1', 'A', 'alice', undefined, 'audiobook');
    expect(logger.error).toHaveBeenCalledWith('Audiobookshelf item step (requester tags, Explicit flag) failed: db down');
  });

  it('a listed item already holding its tag: no ABS call', async () => {
    available('r1', 'b1', 'u-alice');

    await run([listed('item-b1', ['x', 'req:alice'])]);

    expect(state.tagCalls).toEqual([]);
  });

  it('repair: a listed item without a tags array is never read', async () => {
    available('r1', 'b1', 'u-alice');

    await run([listed('item-b1')]);

    expect(state.tagCalls).toEqual([]);
  });

  it('repair: a listed tag list missing an older eligible request\'s tag is fixed', async () => {
    available('r1', 'b1', 'u-alice');

    await run([listed('item-b1', ['Fiction'])]);

    expect(state.tagCalls).toEqual([{ itemId: 'item-b1', tags: ['req:alice'] }]);
  });

  it('repair cap: 30 drifted items → 25 repaired and one line; books delivered this run are still tagged', async () => {
    const items: LibraryItem[] = [];
    for (let i = 0; i < 30; i++) {
      available(`old${i}`, `old${i}`, 'u-alice');
      items.push(listed(`item-old${i}`, []));
    }
    asinMatched('n1', 'asin1', 'u-bob');
    asinMatched('n2', 'asin2', 'u-bob');

    await run(items);

    const ids = state.tagCalls.map((c) => c.itemId);
    expect(ids.slice(0, 2).sort()).toEqual(['item-asin1', 'item-asin2']);
    expect(ids.filter((id) => id.startsWith('item-old'))).toHaveLength(25);
    expect(logger.info).toHaveBeenCalledWith('5 more items need their requester tag or Explicit flag; the next scan continues');
  });

  it('a deleted request is never tagged', async () => {
    available('r1', 'b1', 'u-alice', { deletedAt: new Date() });

    await run([listed('item-b1', [])]);

    expect(state.tagCalls).toEqual([]);
  });

  it('two eligible requests of one book give two tags on one write', async () => {
    available('r1', 'b1', 'u-alice');
    available('r2', 'b1', 'u-bob');

    await run([listed('item-b1', [])]);

    expect(state.tagCalls).toEqual([{ itemId: 'item-b1', tags: ['req:alice', 'req:bob'] }]);
  });

  it('a shared tag is refused with one warning per run; a pending user\'s request is skipped', async () => {
    user('u-js1', 'john.smith');
    user('u-js2', 'johnsmith');
    user('u-pat', 'pat', { registrationStatus: 'pending_approval' });
    available('r1', 'b1', 'u-js1');
    available('r2', 'b2', 'u-js1');
    available('r3', 'b3', 'u-pat');

    await run([listed('item-b1', []), listed('item-b2', []), listed('item-b3', [])]);

    expect(state.tagCalls).toEqual([]);
    expect(logger.warn.mock.calls.filter((c) => String(c[0]).startsWith('Not tagging with req:johnsmith'))).toHaveLength(1);
  });

  it('3 failures in a row stop the run with one error line (403 hint)', async () => {
    state.tagResult = () => ({ tags: 'failed', addedTags: [], explicit: 'none', error: 'ABS API error: 403 Forbidden', httpStatus: 403 });
    for (let i = 0; i < 5; i++) available(`r${i}`, `b${i}`, 'u-alice');

    await run([0, 1, 2, 3, 4].map((i) => listed(`item-b${i}`, [])));

    expect(state.tagCalls).toHaveLength(3);
    expect(logger.error).toHaveBeenCalledWith(
      "Audiobookshelf item writes stopped for this run after 3 failures in a row: the Audiobookshelf API key's user needs permission to update items"
    );
  });
});
