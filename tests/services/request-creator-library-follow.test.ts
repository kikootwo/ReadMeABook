/**
 * Component: Ownership after a library ASIN follow (#325a), guard
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * The follow writes only audiobooks.library_asin. Book X (requested, `available`) followed to the
 * library's Y stays owned through its row, and Y through plex_library, on every automatic caller:
 * the request creator (manual and automatic), the real watched-lists sync and the real shelf sync.
 * The followed state is produced by the real follow. Mocked: prisma (a small table), Audible
 * scraper/details, works service, job queue, config.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: () => log, forJob: () => log } }));
const jobQueue = vi.hoisted(() => ({ addSearchJob: vi.fn(), addNotificationJob: vi.fn() }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueue }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: vi.fn(async () => null), getAudibleRegion: vi.fn(async () => 'us') }) }));
const scrapeSeriesPage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/integrations/audible-series', () => ({ scrapeSeriesPage }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ getAudiobookDetails: vi.fn(async () => null), searchByAuthorAsin: vi.fn(async () => ({ books: [] })) }),
}));
vi.mock('@/lib/utils/deduplicate-audiobooks', () => ({ deduplicateAndCollectGroups: (books: unknown[]) => ({ books, groups: [] }) }));
vi.mock('@/lib/services/works.service', () => ({
  getSiblingAsins: vi.fn(async () => new Map()),
  persistDedupGroups: vi.fn(async () => undefined),
  seedAsin: vi.fn(async () => undefined),
}));

const X = 'B082BHJMFF';
const Y = 'B072R1CY4P';
const MARTIAN = { asin: X, title: 'The Martian', author: 'Andy Weir' };
const ARTEMIS = { asin: Y, title: 'Artemis', author: 'Andy Weir' };

const book = { id: 'ab-1', title: 'The Martian', audibleAsin: X, libraryAsin: null as string | null, absItemId: 'abs-1' };
const available = { id: 'req-1', userId: 'owner', audiobookId: 'ab-1', type: 'audiobook', status: 'available', deletedAt: null };
const plex = [{ plexGuid: 'abs-1', plexRatingKey: null, title: 'Artemis', author: 'Andy Weir', asin: Y }];

type Where = { asin?: string | { in?: string[] }; OR?: { asin?: string }[]; audiobook?: { audibleAsin?: string }; status?: { in?: string[] } };

function wireTables() {
  prismaMock.audiobook.updateMany.mockImplementation(async (a: { where: { absItemId?: unknown }; data: { libraryAsin: string | null } }) => {
    if (a.where.absItemId === null) return { count: 0 }; // the unlinked sweep
    book.libraryAsin = a.data.libraryAsin;
    return { count: 1 };
  });
  prismaMock.audiobook.findMany.mockImplementation(async () => [{ ...book }]);
  prismaMock.plexLibrary.findMany.mockImplementation(async (a: { where: Where & { plexGuid?: { in: string[] } } }) => {
    const w = a.where;
    if (w.plexGuid) return plex.filter((r) => w.plexGuid!.in.includes(r.plexGuid));
    if (w.OR) return plex.filter((r) => w.OR!.some((c) => c.asin === r.asin));
    if (typeof w.asin === 'object' && w.asin.in) return plex.filter((r) => (w.asin as { in: string[] }).in.includes(r.asin));
    return [];
  });
  // Active-request lookup by ASIN: only X's row holds an available request
  prismaMock.request.findFirst.mockImplementation(async (a: { where: Where }) =>
    a.where.audiobook?.audibleAsin === X && a.where.status?.in?.includes('available') ? { ...available } : null);
}

describe('ownership after a follow (#325a)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    book.libraryAsin = null;
    wireTables();
    const { followLibraryAsins } = await import('@/lib/services/library/follow-library-asin');
    await followLibraryAsins('audiobookshelf', log as never);
    expect(book.libraryAsin, 'precondition: the real follow stored Y').toBe(Y);
  });

  const nothingCreated = () => {
    expect(prismaMock.request.create).not.toHaveBeenCalled();
    expect(prismaMock.audiobook.create).not.toHaveBeenCalled();
    expect(jobQueue.addSearchJob).not.toHaveBeenCalled();
  };

  it.each([
    ['X, manual', MARTIAN, { bypassIgnore: true }],
    ['X, automatic', MARTIAN, { automatic: true }],
    ['Y, manual (owned through plex_library)', ARTEMIS, { bypassIgnore: true }],
    ['Y, automatic', ARTEMIS, { automatic: true }],
  ])('creator: %s → already_available', async (_label, input, options) => {
    const { createRequestForUser } = await import('@/lib/services/request-creator.service');
    const result = await createRequestForUser('other-user', input, options);
    expect(result).toMatchObject({ success: false, reason: 'already_available' });
    nothingCreated();
  });

  it('watched lists (real service) offering X and Y: no request, no search job', async () => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([{
      id: 'ws-1', userId: 'u-2', seriesAsin: 'B0SERIES01', seriesTitle: 'Weir', coverArtUrl: null, lastCheckedAt: null,
      newReleasesOnly: false, newReleasesSince: null, user: { id: 'u-2', plexUsername: 'watcher', deletedAt: null },
    }]);
    prismaMock.watchedAuthor.findMany.mockResolvedValue([]);
    prismaMock.watchedSeries.update.mockResolvedValue({});
    scrapeSeriesPage.mockResolvedValue({ asin: 'B0SERIES01', title: 'Weir', bookCount: 2, books: [MARTIAN, ARTEMIS], hasMore: false, page: 1 });

    const { processWatchedLists } = await import('@/lib/services/watched-lists.service');
    const stats = await processWatchedLists();

    expect(stats.seriesChecked).toBe(1);
    expect(stats.requestsCreated).toBe(0);
    expect(stats.skippedOwned, 'Y: owned through plex_library').toBe(1);
    expect(stats.skippedExisting, 'X: the creator answers already_available').toBe(1);
    nothingCreated();
  });

  it('shelf sync (real service) with a mapped X: no request, no search job', async () => {
    prismaMock.bookMapping.findUnique.mockResolvedValue({
      id: 'bm-1', provider: 'goodreads', externalBookId: 'gr-1', audibleAsin: X, title: 'The Martian', author: 'Andy Weir',
      coverUrl: null, lastSearchAt: new Date(),
    });
    prismaMock.bookMapping.findMany.mockResolvedValue([]);
    prismaMock.audibleCache.findMany.mockResolvedValue([]);
    const stats = { shelvesProcessed: 0, booksFound: 0, lookupsPerformed: 0, requestsCreated: 0, errors: 0 };

    const { processShelfBooks } = await import('@/lib/services/shelf-sync-core.service');
    await processShelfBooks('goodreads', [{ bookId: 'gr-1', title: 'The Martian', author: 'Andy Weir' }], 'u-3', 'shelf-1', stats, log as never, 0);

    expect(stats.requestsCreated).toBe(0);
    expect(stats.lookupsPerformed).toBe(0);
    nothingCreated();
  });
});
