/**
 * Component: Watched Lists Heal Tests (#599)
 * Documentation: documentation/features/watched-lists.md
 *
 * A watched series or author whose volumes 1-3 were wrongly linked into one work, with
 * vol 1 owned: the heal must run before the owned check, so vols 2/3 get requested.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import type { AudibleAudiobook } from '@/lib/integrations/audible.service';

const prismaMock = createPrismaMock();
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

vi.mock('@/lib/utils/logger', () => {
  const log = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  return { RMABLogger: { create: log, forJob: log } };
});

const SERIES = 'B0H3C5X19W';
const [V1, V2, V3] = ['B0H36S85HC', 'B0H6N477LX', 'B0H6N6TH8T'];
const vols = (): AudibleAudiobook[] =>
  [V1, V2, V3].map((asin, i) => ({
    asin,
    title: 'Die Tagebücher der Apothekerin',
    author: 'Author',
    narrator: 'Narrator One',
    durationMinutes: i === 0 ? 506 : 500,
    seriesAsin: SERIES,
    seriesPart: String(i + 1),
  }));

const mockScrapeSeriesPage = vi.fn();
vi.mock('@/lib/integrations/audible-series', () => ({ scrapeSeriesPage: (...a: unknown[]) => mockScrapeSeriesPage(...a) }));

const mockSearchByAuthorAsin = vi.fn();
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ searchByAuthorAsin: mockSearchByAuthorAsin }),
  AUDIBLE_PAGE_SIZE: 50,
}));

const order: string[] = [];
const mockHeal = vi.fn(async () => { order.push('heal'); });
vi.mock('@/lib/services/works-heal', () => ({ detachVetoedAsins: (...a: unknown[]) => mockHeal(...(a as [])) }));

const mockFill = vi.fn(async (rows: AudibleAudiobook[]) => rows);
vi.mock('@/lib/integrations/audible-series-positions', () => ({
  fillSeriesPositions: (...a: unknown[]) => mockFill(...(a as [AudibleAudiobook[]])),
}));

// Siblings as the works table answers them: vols 2/3 link to vol 1 until the heal has run
const mockGetSiblingAsins = vi.fn(async (asins: string[]) => {
  order.push('owned-check');
  const linked = !order.includes('heal');
  return new Map(asins.filter((a) => linked && a !== V1).map((a) => [a, [V1]]));
});
vi.mock('@/lib/services/works.service', () => ({
  persistDedupGroups: vi.fn(async () => {}),
  getSiblingAsins: (...a: unknown[]) => mockGetSiblingAsins(...(a as [string[]])),
}));

const mockCreateRequestForUser = vi.fn();
vi.mock('@/lib/services/request-creator.service', () => ({
  createRequestForUser: (...a: unknown[]) => mockCreateRequestForUser(...a),
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn().mockResolvedValue(null) }));

const USER = { id: 'user-1', plexUsername: 'testuser', deletedAt: null };

describe('watched sync heals wrongly linked volumes before the owned check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    order.length = 0;
    // Vol 1 is in the library
    prismaMock.plexLibrary.findMany.mockImplementation(async (args: { where: { asin: { in: string[] } } }) =>
      args.where.asin.in.filter((a) => a === V1).map((asin) => ({ asin })));
    mockCreateRequestForUser.mockResolvedValue({ success: true, request: {} });
    prismaMock.watchedSeries.update.mockResolvedValue({});
    prismaMock.watchedAuthor.update.mockResolvedValue({});
  });

  it('watched series: requests vols 2 and 3', async () => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([
      { id: 'ws-1', userId: USER.id, seriesAsin: SERIES, seriesTitle: 'Die Tagebücher der Apothekerin', user: USER },
    ]);
    prismaMock.watchedAuthor.findMany.mockResolvedValue([]);
    mockScrapeSeriesPage.mockResolvedValueOnce({ asin: SERIES, title: 'Series', bookCount: 3, books: vols(), hasMore: false, page: 1 });

    const { processWatchedLists } = await import('@/lib/services/watched-lists.service');
    await processWatchedLists();

    expect(mockFill).toHaveBeenCalledWith(expect.any(Array), SERIES);
    expect(mockHeal).toHaveBeenCalledTimes(1);
    expect(order.indexOf('heal')).toBeLessThan(order.indexOf('owned-check'));
    expect(mockCreateRequestForUser.mock.calls.map((c) => c[1].asin)).toEqual([V2, V3]);
  });

  it('watched author: requests vols 2 and 3', async () => {
    prismaMock.watchedSeries.findMany.mockResolvedValue([]);
    prismaMock.watchedAuthor.findMany.mockResolvedValue([
      { id: 'wa-1', userId: USER.id, authorAsin: 'B000AUTHOR', authorName: 'Author', newReleasesSince: null, user: USER },
    ]);
    mockSearchByAuthorAsin.mockResolvedValue({ books: vols(), hasMore: false, page: 1, totalResults: 3 });

    const { processWatchedLists } = await import('@/lib/services/watched-lists.service');
    await processWatchedLists();

    expect(mockHeal).toHaveBeenCalledTimes(1);
    expect(order.indexOf('heal')).toBeLessThan(order.indexOf('owned-check'));
    expect(mockCreateRequestForUser.mock.calls.map((c) => c[1].asin)).toEqual([V2, V3]);
  });
});
