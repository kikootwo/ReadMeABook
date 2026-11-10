/**
 * Component: Requester tags, eligibility by path and step (#232)
 * Documentation: documentation/features/requester-tags.md
 *
 * A request completed without approval (`approvalBypassedBy` set by the ASIN match, a manual import
 * or a bulk import) is never tagged on delivery, repair or backfill, while another eligible request
 * of the same book still is. A named manual import (marker NULL) and a legacy row are tagged.
 * Real: match-requests, request-library-link, requester-tags. Mocked: prisma (in-memory holder),
 * the ASIN matcher, the job queue, config, writeABSItem.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { createLibraryDb, resetLibraryDb, wireLibraryDb, type Row } from '../helpers/library-link-db';
import type { RMABLogger } from '@/lib/utils/logger';
import type { LibraryItem } from '@/lib/services/library/ILibraryService';

const prismaMock = createPrismaMock();
const state = vi.hoisted(() => ({ tagCalls: [] as Array<{ itemId: string; tags?: string[] }> }));
const jobQueueMock = vi.hoisted(() => ({ addNotificationJob: vi.fn() }));
const findPlexMatchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: findPlexMatchMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ get: async (key: string) => (key === 'audiobookshelf.tag_requester' ? 'true' : null), clearCache: () => {} }),
}));
vi.mock('@/lib/services/audiobookshelf/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/audiobookshelf/api')>()),
  writeABSItem: async (itemId: string, want: { tags?: string[] }) => {
    state.tagCalls.push({ itemId, ...want });
    return { tags: 'added', addedTags: want.tags ?? [], explicit: 'none' };
  },
}));

const db = createLibraryDb();
const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as RMABLogger;
const MEDIA = '/media/audiobooks';
const FOLDER = 'Author/Book B0LINKED1';
const DELIVERED = new Date('2026-10-20T12:00:00Z');
const LINK_ITEM: LibraryItem = {
  id: 'abs-link', externalId: 'abs-link', title: 'Book', author: 'Author', path: `/audiobooks/${FOLDER}`,
  isMissing: false, addedAt: new Date('2026-10-20T12:05:00Z'), updatedAt: new Date('2026-10-20T12:05:00Z'),
};
const IMPORT_MARKS = ['manual_import:denied', 'bulk_import:cancelled', 'bulk_import:awaiting_approval'];
const ALL_MARKS = ['asin_match:awaiting_approval', ...IMPORT_MARKS];

const book = (id: string, over: Row = {}) => db.audiobooks.push({ id, audibleAsin: `B0${id}`, title: `Book ${id}`, author: 'A', narrator: null, filePath: null, absItemId: null, ...over });
const request = (id: string, audiobookId: string, userId: string, status: string, over: Row = {}) =>
  db.requests.push({ id, audiobookId, userId, type: 'audiobook', status, deletedAt: null, approvalBypassedBy: null, errorMessage: null, ...over });
const listed = (itemId: string, tags?: string[]): LibraryItem => ({ id: itemId, externalId: itemId, title: itemId, author: 'A', addedAt: new Date(), updatedAt: new Date(), ...(tags ? { tags } : {}) });

/** Book delivered by RMAB to FOLDER; its `downloaded` requests link to LINK_ITEM this run. */
function linkedBook() {
  db.plex.push({ id: 'row-link', plexGuid: 'abs-link', plexLibraryId: 'lib-1', filePath: LINK_ITEM.path, addedAt: LINK_ITEM.addedAt, asin: null });
  book('ab-link', { audibleAsin: 'B0LINKED1', filePath: `${MEDIA}/${FOLDER}`, filesHash: 'f'.repeat(64), completedAt: DELIVERED, plexGuid: null });
}
const linkedRequest = (id: string, userId: string, over: Row = {}) =>
  request(id, 'ab-link', userId, 'downloaded', { completedAt: DELIVERED, updatedAt: DELIVERED, ...over });

async function scan(listedItems: LibraryItem[] = []) {
  const { matchRequestsToLibrary } = await import('@/lib/services/library/match-requests');
  return matchRequestsToLibrary({ backendMode: 'audiobookshelf', libraryId: 'lib-1', listedItems, logger });
}
async function backfill(listedItems: LibraryItem[]) {
  const { applyItemMarks } = await import('@/lib/services/audiobookshelf/requester-tags');
  return applyItemMarks({ deliveredBookIds: [], listedItems, logger, tagging: true, explicit: true, mode: 'backfill' });
}

describe('requester tag eligibility by path and step (#232)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLibraryDb(db);
    wireLibraryDb(prismaMock, db, MEDIA);
    state.tagCalls = [];
    jobQueueMock.addNotificationJob.mockResolvedValue(undefined);
    findPlexMatchMock.mockImplementation(async ({ asin }: { asin: string }) => (asin === 'B0asin' ? { plexGuid: 'item-asin', title: 'M' } : null));
    db.users.push(
      { id: 'u-carol', plexUsername: 'carol', deletedAt: null, registrationStatus: 'approved' },
      { id: 'u-bob', plexUsername: 'bob', deletedAt: null, registrationStatus: 'approved' },
    );
  });

  describe('delivery', () => {
    it('asin_match:awaiting_approval: the matched request is marked and not tagged; an eligible request of the book is', async () => {
      book('asin');
      request('r-carol', 'asin', 'u-carol', 'awaiting_approval');
      request('r-bob', 'asin', 'u-bob', 'pending');

      const result = await scan();

      expect(result.matched).toBe(2);
      expect(db.requests.find((r) => r.id === 'r-carol')).toMatchObject({ status: 'available', approvalBypassedBy: 'asin_match:awaiting_approval' });
      expect(state.tagCalls).toEqual([{ itemId: 'item-asin', tags: ['req:bob'] }]);
    });

    it.each(IMPORT_MARKS)('%s: the linked request is not tagged; an eligible request of the book is', async (mark) => {
      linkedBook();
      linkedRequest('r-carol', 'u-carol', { approvalBypassedBy: mark });
      linkedRequest('r-bob', 'u-bob');

      const result = await scan([{ ...LINK_ITEM }]);

      expect(result.linkedByPath).toBe(2);
      expect(state.tagCalls).toEqual([{ itemId: 'abs-link', tags: ['req:bob'] }]);
    });

    it.each(IMPORT_MARKS)('%s alone: no ABS call', async (mark) => {
      linkedBook();
      linkedRequest('r-carol', 'u-carol', { approvalBypassedBy: mark });

      await scan([{ ...LINK_ITEM }]);

      expect(state.tagCalls).toEqual([]);
      expect(logger.info).toHaveBeenCalledWith('1 requests delivered without approval are not tagged');
    });

    it('a named manual import (marker NULL) is tagged', async () => {
      linkedBook();
      linkedRequest('r-carol', 'u-carol');

      await scan([{ ...LINK_ITEM }]);

      expect(state.tagCalls).toEqual([{ itemId: 'abs-link', tags: ['req:carol'] }]);
    });
  });

  describe('repair', () => {
    it.each(ALL_MARKS)('%s: a listed tag list missing the tag is left alone; an eligible request of the book is fixed', async (mark) => {
      book('b1', { absItemId: 'item-b1' });
      request('r-carol', 'b1', 'u-carol', 'available', { approvalBypassedBy: mark });

      await scan([listed('item-b1', ['Fiction'])]);
      expect(state.tagCalls).toEqual([]);

      request('r-bob', 'b1', 'u-bob', 'available');
      await scan([listed('item-b1', ['Fiction'])]);
      expect(state.tagCalls).toEqual([{ itemId: 'item-b1', tags: ['req:bob'] }]);
    });
  });

  describe('backfill', () => {
    it.each(ALL_MARKS)('%s: no ABS call, counted skippedUnapproved', async (mark) => {
      book('b1', { absItemId: 'item-b1' });
      request('r-carol', 'b1', 'u-carol', 'available', { approvalBypassedBy: mark });

      const result = await backfill([listed('item-b1')]);

      expect(state.tagCalls).toEqual([]);
      expect(result).toMatchObject({ considered: 1, skippedUnapproved: 1, tagged: 0 });
    });

    it('a legacy row (marker NULL) is tagged, even listed without a tag array', async () => {
      book('b1', { absItemId: 'item-b1' });
      request('r-carol', 'b1', 'u-carol', 'available');

      const result = await backfill([listed('item-b1')]);

      expect(state.tagCalls).toEqual([{ itemId: 'item-b1', tags: ['req:carol'] }]);
      expect(result).toMatchObject({ considered: 1, tagged: 1, skippedUnapproved: 0 });
    });
  });

  // An import with no request to recycle creates one for the importing admin: no user asked for it.
  // Told apart by owner and history: an admin's request with no download record.
  describe('an admin\'s import nobody requested', () => {
    beforeEach(() => {
      db.users.push({ id: 'u-admin', plexUsername: 'admin', deletedAt: null, registrationStatus: null, role: 'admin' });
    });

    it('delivery: the admin\'s import is not tagged; a user\'s request of the book is', async () => {
      linkedBook();
      linkedRequest('r-admin', 'u-admin');
      linkedRequest('r-bob', 'u-bob');

      await scan([{ ...LINK_ITEM }]);

      expect(state.tagCalls).toEqual([{ itemId: 'abs-link', tags: ['req:bob'] }]);
    });

    it('delivery: alone, no ABS call', async () => {
      linkedBook();
      linkedRequest('r-admin', 'u-admin');

      await scan([{ ...LINK_ITEM }]);

      expect(state.tagCalls).toEqual([]);
    });

    it('repair: a listed tag list without req:admin is left alone', async () => {
      book('b1', { absItemId: 'item-b1' });
      request('r-admin', 'b1', 'u-admin', 'available');

      await scan([listed('item-b1', ['Fiction'])]);

      expect(state.tagCalls).toEqual([]);
    });

    it('backfill: no ABS call, counted skippedImported', async () => {
      book('b1', { absItemId: 'item-b1' });
      request('r-admin', 'b1', 'u-admin', 'available');

      const result = await backfill([listed('item-b1')]);

      expect(state.tagCalls).toEqual([]);
      expect(result).toMatchObject({ considered: 1, skippedImported: 1, tagged: 0 });
    });

    it('an admin\'s request that RMAB downloaded is tagged on every path', async () => {
      book('b1', { absItemId: 'item-b1' });
      request('r-admin', 'b1', 'u-admin', 'available', { downloads: 1 });

      const result = await backfill([listed('item-b1')]);
      await scan([listed('item-b1', ['Fiction'])]);

      expect(result).toMatchObject({ tagged: 1, skippedImported: 0 });
      expect(state.tagCalls).toEqual([
        { itemId: 'item-b1', tags: ['req:admin'] },
        { itemId: 'item-b1', tags: ['req:admin'] },
      ]);
    });

    it('a user\'s request with no download record (a named import) is still tagged', async () => {
      book('b1', { absItemId: 'item-b1' });
      request('r-carol', 'b1', 'u-carol', 'available');

      const result = await backfill([listed('item-b1')]);

      expect(result).toMatchObject({ tagged: 1, skippedImported: 0 });
    });
  });

  describe('the candidate read', () => {
    it('one read, filtered to the delivered books and the listed items', async () => {
      book('b1', { absItemId: 'item-b1' });
      book('b2', { absItemId: 'item-b2' });
      request('r-carol', 'b1', 'u-carol', 'available');
      request('r-bob', 'b2', 'u-bob', 'available');
      const { applyItemMarks } = await import('@/lib/services/audiobookshelf/requester-tags');

      const result = await applyItemMarks({ deliveredBookIds: ['b9'], listedItems: [listed('item-b1')], logger, tagging: true, explicit: true, mode: 'backfill' });

      const reads = prismaMock.request.findMany.mock.calls.map((c) => c[0]);
      expect(reads).toHaveLength(1);
      expect(reads[0].where.OR).toEqual([{ audiobookId: { in: ['b9'] } }, { audiobook: { absItemId: { in: ['item-b1'] } } }]);
      expect(result.considered).toBe(1);
      expect(state.tagCalls).toEqual([{ itemId: 'item-b1', tags: ['req:carol'] }]);
    });

    // Listed ids are read 1,000 at a time; the delivered books go in the first read only
    it.each([[999, 1], [1000, 1], [1001, 2], [2000, 2], [2001, 3]])('%i listed items: %i reads, no id lost or doubled at a chunk edge', async (count, expectedReads) => {
      const ids = Array.from({ length: count }, (_, i) => `item-${i}`);
      ids.forEach((itemId, i) => {
        book(`b${i}`, { absItemId: itemId });
        request(`r-${i}`, `b${i}`, 'u-carol', 'available');
      });
      const { applyItemMarks } = await import('@/lib/services/audiobookshelf/requester-tags');

      const result = await applyItemMarks({ deliveredBookIds: ['b0'], listedItems: ids.map((id) => listed(id)), logger, tagging: true, explicit: true, mode: 'backfill' });

      type Clause = { audiobookId?: { in: string[] }; audiobook?: { absItemId: { in: string[] } } };
      const ors = prismaMock.request.findMany.mock.calls.map((c) => c[0].where.OR as Clause[]);
      expect(ors).toHaveLength(expectedReads);
      const readIds = ors.map((or) => or.find((c) => c.audiobook)!.audiobook!.absItemId.in);
      readIds.forEach((chunk, i) => expect(chunk).toEqual(ids.slice(i * 1000, (i + 1) * 1000)));
      expect(ors.map((or) => or.filter((c) => c.audiobookId).length)).toEqual([1, ...Array(expectedReads - 1).fill(0)]);
      expect(result).toMatchObject({ considered: count, tagged: count });
      const tagged = state.tagCalls.map((c) => c.itemId);
      expect(new Set(tagged).size).toBe(count);
      expect(tagged).toEqual(expect.arrayContaining([ids[0], ids[count - 1], ...ids.slice(998, 1002)]));
    });
  });
});
