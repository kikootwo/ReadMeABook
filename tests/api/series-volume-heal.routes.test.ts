/**
 * Component: Series Volume Heal in the Catalog Routes (#599)
 * Documentation: documentation/integrations/audible.md
 *
 * The series, search and author routes heal wrongly linked volumes before dedup. The heal
 * writes on a GET: a rejected heal must never turn the page into an error.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({
  scrapeSeriesPage: vi.fn(),
  search: vi.fn(),
  searchByAuthorAsin: vi.fn(),
  heal: vi.fn(),
  fill: vi.fn(),
  persist: vi.fn(async () => {}),
  order: [] as string[],
}));

vi.mock('@/lib/middleware/auth', () => ({
  requireAuth: (_req: unknown, handler: (req: unknown) => unknown) => handler({ user: { id: 'u1' } }),
  getOptionalAuthUser: async () => ({ id: 'u1' }),
}));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock('@/lib/integrations/audible-series', () => ({ scrapeSeriesPage: m.scrapeSeriesPage }));
vi.mock('@/lib/integrations/audible.service', () => ({
  getAudibleService: () => ({ search: m.search, searchByAuthorAsin: m.searchByAuthorAsin }),
}));
vi.mock('@/lib/integrations/audible-series-positions', () => ({ fillSeriesPositions: m.fill }));
vi.mock('@/lib/services/works-heal', () => ({ detachVetoedAsins: m.heal }));
vi.mock('@/lib/services/works.service', () => ({
  persistDedupGroups: m.persist,
  collapseByExistingWorks: async (books: unknown[]) => { m.order.push('collapse'); return books; },
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ enrichAudiobooksWithMatches: async (books: unknown[]) => books }));
vi.mock('@/lib/utils/ignored-audiobooks', () => ({ annotateWithIgnoreStatus: async (books: unknown[]) => books }));

const SERIES = 'B0H3C5X19W';
const books = [
  { asin: 'B0H36S85HC', title: 'T', author: 'A', seriesAsin: SERIES, seriesPart: '1' },
  { asin: 'B0H6N477LX', title: 'T', author: 'A', seriesAsin: SERIES, seriesPart: '2' },
];
const req = (path: string) => new NextRequest(`http://localhost${path}`);
const params = (asin: string) => ({ params: Promise.resolve({ asin }) });

describe('catalog routes with the heal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.order.length = 0;
    m.heal.mockImplementation(async () => { m.order.push('heal'); throw new Error('heal failed'); });
    m.fill.mockImplementation(async (rows: unknown[]) => { m.order.push('fill'); return rows; });
    m.scrapeSeriesPage.mockResolvedValue({ asin: SERIES, title: 'Series', books, hasMore: false, page: 1 });
    m.search.mockResolvedValue({ query: 'q', results: books, totalResults: 2, page: 1, hasMore: false });
    m.searchByAuthorAsin.mockResolvedValue({ books, hasMore: false, page: 1, totalResults: 2 });
  });

  it('series: fills positions, heals, then collapses; a rejected heal still returns 200 with both volumes', async () => {
    const { GET } = await import('@/app/api/series/[asin]/route');
    const res = await GET(req(`/api/series/${SERIES}`), params(SERIES));

    expect(res.status).toBe(200);
    expect((await res.json()).series.books).toHaveLength(2);
    expect(m.fill).toHaveBeenCalledWith(books, SERIES);
    expect(m.heal).toHaveBeenCalledWith(books);
    expect(m.order).toEqual(['fill', 'heal', 'collapse']);
  });

  it('search: a rejected heal still returns 200', async () => {
    const { GET } = await import('@/app/api/audiobooks/search/route');
    const res = await GET(req('/api/audiobooks/search?q=apothekerin'));

    expect(res.status).toBe(200);
    expect(m.heal).toHaveBeenCalledWith(books);
    expect(m.order).toEqual(['heal', 'collapse']);
  });

  it('author books: a rejected heal still returns 200', async () => {
    const { GET } = await import('@/app/api/authors/[asin]/books/route');
    const res = await GET(req('/api/authors/B000AUTHOR/books?name=Author'), params('B000AUTHOR'));

    expect(res.status).toBe(200);
    expect(m.heal).toHaveBeenCalledWith(books);
    expect(m.order).toEqual(['heal', 'collapse']);
  });
});
