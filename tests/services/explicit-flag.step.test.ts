/**
 * Component: Library scan delivery step, the Explicit flag (#542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * matchRequestsToLibrary's delivery step: an item is flagged when any candidate request of it is
 * marked (tag rules don't apply); tagging off reads only marked rows and never sends tags; repair
 * acts on a listed flag that is off (null counts as off), shares the 25-item cap and the 3-failure
 * stop; the key-user guard skips the write and warns once per run, also when marked books sit in
 * the library and nothing is written. Real: match-requests, request-library-link, requester-tags,
 * explicit-flag. Mocked: prisma (in-memory holder), the ASIN matcher, the job queue, config,
 * writeABSItem, canKeyUserSeeExplicit.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createLibraryDb, resetLibraryDb, wireLibraryDb, type Row } from '../helpers/library-link-db';
import type { RMABLogger } from '@/lib/utils/logger';
import type { LibraryItem } from '@/lib/services/library/ILibraryService';

type Want = { tags?: string[]; explicit?: true };
const prismaMock = createPrismaMock();
const state = vi.hoisted(() => ({
  config: {} as Record<string, string>,
  writes: [] as Array<{ itemId: string } & Want>,
  canSee: true as boolean,
  meReads: 0,
  result: null as null | ((itemId: string, want: Want) => unknown),
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
  writeABSItem: async (itemId: string, want: Want) => {
    state.writes.push({ itemId, ...want });
    return state.result?.(itemId, want) ?? { tags: want.tags ? 'added' : 'none', addedTags: want.tags ?? [], explicit: want.explicit ? 'set' : 'none' };
  },
  canKeyUserSeeExplicit: async () => {
    state.meReads++;
    return state.canSee;
  },
}));

const db = createLibraryDb();
const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
const TAGS_ON = { 'audiobookshelf.tag_requester': 'true' };

/** A book already in the library (absItemId set) with an available request. */
function available(reqId: string, bookId: string, userId: string, over: Row = {}) {
  if (!db.audiobooks.some((a) => a.id === bookId)) {
    db.audiobooks.push({ id: bookId, audibleAsin: `B0${bookId}`, title: `Book ${bookId}`, author: 'A', narrator: null, filePath: null, absItemId: `item-${bookId}` });
  }
  db.requests.push({ id: reqId, audiobookId: bookId, userId, type: 'audiobook', status: 'available', deletedAt: null, approvalBypassedBy: null, explicit: false, ...over });
}

/** A request the ASIN match completes this run (findPlexMatch returns item-<bookId>). */
function asinMatched(reqId: string, bookId: string, userId: string, over: Row = {}) {
  db.audiobooks.push({ id: bookId, audibleAsin: `B0${bookId}`, title: `Book ${bookId}`, author: 'A', narrator: null, filePath: null, absItemId: null });
  db.requests.push({ id: reqId, audiobookId: bookId, userId, type: 'audiobook', status: 'pending', deletedAt: null, approvalBypassedBy: null, explicit: false, ...over });
}

const listed = (itemId: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  id: itemId, externalId: itemId, title: itemId, author: 'A', addedAt: new Date(), updatedAt: new Date(), ...over,
});
const warnings = () => logger.warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("can't see explicit books"));

async function run(listedItems: LibraryItem[] = [], backendMode = 'audiobookshelf') {
  const { matchRequestsToLibrary } = await import('@/lib/services/library/match-requests');
  return matchRequestsToLibrary({ backendMode, libraryId: 'lib-1', listedItems, logger: logger as unknown as RMABLogger });
}

describe('Explicit flag in the delivery step (#542)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLibraryDb(db);
    wireLibraryDb(prismaMock, db, '/media');
    state.config = { ...TAGS_ON };
    state.writes = [];
    state.canSee = true;
    state.meReads = 0;
    state.result = null;
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    findPlexMatchMock.mockImplementation(async ({ asin }: { asin: string }) =>
      (asin.startsWith('B0asin') ? { plexGuid: `item-${asin.slice(2)}`, title: 'Matched' } : null));
    db.users.push(
      { id: 'u-alice', plexUsername: 'alice', deletedAt: null, registrationStatus: 'approved' },
      { id: 'u-admin', plexUsername: 'admin', deletedAt: null, registrationStatus: null, role: 'admin' },
    );
  });

  it('a marked delivery gets its tag and the flag in one write; the info line names it', async () => {
    asinMatched('r1', 'asin1', 'u-alice', { explicit: true });

    await run();

    expect(state.writes).toEqual([{ itemId: 'item-asin1', tags: ['req:alice'], explicit: true }]);
    expect(logger.info).toHaveBeenCalledWith('Marked "Book asin1" (Audiobookshelf item item-asin1) explicit');
  });

  it('an unmarked delivery is never flagged', async () => {
    asinMatched('r1', 'asin1', 'u-alice');

    await run();

    expect(state.writes).toEqual([{ itemId: 'item-asin1', tags: ['req:alice'] }]);
    expect(state.meReads).toBe(0);
  });

  it('two requests of one book, one marked: the item is flagged', async () => {
    available('r1', 'b1', 'u-alice');
    available('r2', 'b1', 'u-admin', { explicit: true, downloads: 1 });

    await run([listed('item-b1', { tags: ['req:alice', 'req:admin'], explicit: false })]);

    expect(state.writes).toEqual([{ itemId: 'item-b1', explicit: true }]);
  });

  it.each([
    ['completed without approval', { approvalBypassedBy: 'asin_match:awaiting_approval' }, 'u-alice'],
    ["an admin's import nobody requested", {}, 'u-admin'],
  ])('%s: flagged, not tagged', async (_label, over, userId) => {
    asinMatched('r1', 'asin1', userId, { explicit: true, ...over });

    await run();

    expect(state.writes).toEqual([{ itemId: 'item-asin1', explicit: true }]);
  });

  describe('tagging off (the default)', () => {
    beforeEach(() => {
      state.config = {};
    });

    it('a marked delivery is flagged; the body carries no tags; no users query; reads are filtered to marked rows', async () => {
      asinMatched('r1', 'asin1', 'u-alice', { explicit: true });

      await run();

      expect(state.writes).toEqual([{ itemId: 'item-asin1', explicit: true }]);
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
      const stepReads = prismaMock.request.findMany.mock.calls.map((c) => c[0]).filter((a) => a?.where?.OR);
      expect(stepReads.length).toBeGreaterThan(0);
      stepReads.forEach((a) => expect(a.where.explicit).toBe(true));
      expect(logger.info.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('not tagged'))).toEqual([]);
    });

    it('nothing marked: no ABS call and no access check', async () => {
      asinMatched('r1', 'asin1', 'u-alice');

      await run([listed('item-x', { explicit: false })]);

      expect(state.writes).toEqual([]);
      expect(state.meReads).toBe(0);
    });
  });

  describe('repair', () => {
    it.each([
      ['false', false],
      ['null (ABS has no default)', null],
    ])('a listed flag that is %s is put back', async (_label, value) => {
      available('r1', 'b1', 'u-alice', { explicit: true });

      await run([listed('item-b1', { tags: ['req:alice'], explicit: value as unknown as boolean })]);

      expect(state.writes).toEqual([{ itemId: 'item-b1', explicit: true }]);
    });

    it('a listing without the key → no write; a listed true → no write', async () => {
      available('r1', 'b1', 'u-alice', { explicit: true });
      available('r2', 'b2', 'u-alice', { explicit: true });

      await run([listed('item-b1', { tags: ['req:alice'] }), listed('item-b2', { tags: ['req:alice'], explicit: true })]);

      expect(state.writes).toEqual([]);
    });

    it('flag and tag repairs share the cap of 25 items; deliveries are uncapped', async () => {
      const items: LibraryItem[] = [];
      for (let i = 0; i < 15; i++) {
        available(`e${i}`, `e${i}`, 'u-alice', { explicit: true });
        items.push(listed(`item-e${i}`, { tags: ['req:alice'], explicit: false }));
      }
      for (let i = 0; i < 15; i++) {
        available(`t${i}`, `t${i}`, 'u-alice');
        items.push(listed(`item-t${i}`, { tags: [], explicit: false }));
      }
      asinMatched('n1', 'asin1', 'u-alice', { explicit: true });

      await run(items);

      expect(state.writes[0].itemId).toBe('item-asin1');
      expect(state.writes.filter((w) => !w.itemId.startsWith('item-asin'))).toHaveLength(25);
      expect(logger.info).toHaveBeenCalledWith('5 more items need their requester tag or Explicit flag; the next scan continues');
    });

    it('3 failed flag writes in a row stop the run (403 hint)', async () => {
      state.result = () => ({ tags: 'none', addedTags: [], explicit: 'failed', error: 'ABS API error: 403 Forbidden', httpStatus: 403 });
      for (let i = 0; i < 5; i++) available(`r${i}`, `b${i}`, 'u-alice', { explicit: true });

      await run([0, 1, 2, 3, 4].map((i) => listed(`item-b${i}`, { tags: ['req:alice'], explicit: false })));

      expect(state.writes).toHaveLength(3);
      expect(logger.warn).toHaveBeenCalledWith('Could not mark "Book b0" (Audiobookshelf item item-b0) explicit: ABS API error: 403 Forbidden');
      expect(logger.error).toHaveBeenCalledWith(
        "Audiobookshelf item writes stopped for this run after 3 failures in a row: the Audiobookshelf API key's user needs permission to update items"
      );
    });
  });

  describe("the key user's access (guard)", () => {
    it('no access: the flag is skipped, the tag still written, one warning naming the book and the consequence', async () => {
      state.canSee = false;
      asinMatched('r1', 'asin1', 'u-alice', { explicit: true });
      asinMatched('r2', 'asin2', 'u-alice', { explicit: true });

      await run();

      expect(state.writes.map((w) => w.explicit)).toEqual([undefined, undefined]);
      expect(state.writes.map((w) => w.tags)).toEqual([['req:alice'], ['req:alice']]);
      expect(state.meReads).toBe(1);
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0]).toMatch(/^Not marking "Book asin1", "Book asin2" explicit: /);
      expect(warnings()[0]).toContain('a full library scan can treat them as removed');
      expect(warnings()[0]).toContain('Can access explicit content');
    });

    it('tagging off and no access: no ABS write at all', async () => {
      state.config = {};
      state.canSee = false;
      asinMatched('r1', 'asin1', 'u-alice', { explicit: true });

      await run();

      expect(state.writes).toEqual([]);
      expect(warnings()).toHaveLength(1);
    });

    it('marked books in the library and nothing to write: the access is still checked once and warned', async () => {
      state.canSee = false;
      available('r1', 'b1', 'u-alice', { explicit: true });

      await run([listed('item-other')]);

      expect(state.writes).toEqual([]);
      expect(state.meReads).toBe(1);
      expect(warnings()).toEqual([expect.stringMatching(/^Not marking books explicit: /)]);
    });

    it('no marked books: never checked, never warned', async () => {
      available('r1', 'b1', 'u-alice');

      await run([listed('item-b1', { tags: ['req:alice'], explicit: false })]);

      expect(state.meReads).toBe(0);
      expect(warnings()).toEqual([]);
    });

    it('with access: checked once per run however many items are flagged', async () => {
      for (let i = 0; i < 3; i++) asinMatched(`r${i}`, `asin${i}`, 'u-alice', { explicit: true });

      await run();

      expect(state.meReads).toBe(1);
      expect(state.writes.filter((w) => w.explicit)).toHaveLength(3);
      expect(warnings()).toEqual([]);
    });
  });

  it('Plex mode: the step never runs', async () => {
    asinMatched('r1', 'asin1', 'u-alice', { explicit: true });

    await run([], 'plex');

    expect(state.writes).toEqual([]);
    expect(state.meReads).toBe(0);
  });
});
