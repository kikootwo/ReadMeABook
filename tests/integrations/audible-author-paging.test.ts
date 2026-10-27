/**
 * Component: Audible Author Catalog Paging Tests
 * Documentation: documentation/integrations/audible.md
 *
 * Issue #310: a catalog page where no product passes the author-ASIN and language
 * filters must not end paging while Audible still has more pages.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const clientMock = vi.hoisted(() => ({ get: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
const configServiceMock = vi.hoisted(() => ({ getAudibleRegion: vi.fn() }));
const currentUserMock = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configServiceMock }));
vi.mock('@/lib/middleware/auth', () => ({ getCurrentUser: currentUserMock }));
vi.mock('@/lib/services/works.service', () => ({
  persistDedupGroups: vi.fn(async () => {}),
  collapseByExistingWorks: vi.fn(async (books: unknown[]) => books),
}));
vi.mock('@/lib/utils/audiobook-matcher', () => ({
  enrichAudiobooksWithMatches: vi.fn(async (books: unknown[]) => books),
}));
vi.mock('@/lib/utils/ignored-audiobooks', () => ({
  annotateWithIgnoreStatus: vi.fn(async (books: unknown[]) => books),
}));

import { AudibleService, AUDIBLE_MAX_AUTHOR_PAGES } from '@/lib/integrations/audible.service';
import { scanAuthorBooks } from '@/lib/services/watched-lists-releases';
import { GET } from '@/app/api/authors/[asin]/books/route';
import type { RMABLogger } from '@/lib/utils/logger';

const AUTHOR = 'A000TOLKEN';
const NAMESAKE = 'A0NAMESAKE';
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as RMABLogger;

const product = (asin: string, authorAsin = AUTHOR, language = 'english') => ({
  asin,
  title: `Title ${asin}`,
  authors: [{ asin: authorAsin, name: 'J.R.R. Tolkien' }],
  narrators: [{ name: `Narrator ${asin}` }],
  runtime_length_min: 100 + asin.charCodeAt(asin.length - 1),
  release_date: '2020-01-01',
  language,
});
const filler = (prefix: string, n: number, make: (asin: string) => ReturnType<typeof product>) =>
  Array.from({ length: n }, (_, i) => make(`${prefix}${String(i).padStart(4, '0')}`));

// 130 products over three raw pages. Page 2 has nothing that passes the filters
// (namesake authors and another language); page 3 holds more of the author's books.
const CATALOG: Record<number, { products: ReturnType<typeof product>[]; total_results: number }> = {
  0: { products: [product('B0PAGE1001'), ...filler('B0P1NS', 49, (a) => product(a, NAMESAKE))], total_results: 130 },
  1: {
    products: [
      ...filler('B0P2NS', 25, (a) => product(a, NAMESAKE)),
      ...filler('B0P2DE', 25, (a) => product(a, AUTHOR, 'german')),
    ],
    total_results: 130,
  },
  2: { products: [product('B0PAGE3001'), product('B0PAGE3002'), ...filler('B0P3NS', 28, (a) => product(a, NAMESAKE))], total_results: 130 },
};

function serveCatalog(catalog: Record<number, { products: unknown[]; total_results: number }>) {
  clientMock.get.mockImplementation(async (_url: string, cfg: { params: { page: number } }) => ({
    data: catalog[cfg.params.page] ?? { products: [], total_results: 0 },
  }));
}

async function run<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  axiosMock.create.mockReturnValue(clientMock);
  configServiceMock.getAudibleRegion.mockResolvedValue('us');
  currentUserMock.mockReturnValue({ sub: 'user-1' });
  serveCatalog(CATALOG);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('searchByAuthorAsin() paging (#310)', () => {
  it('reports more pages after a page where nothing passes the filters', async () => {
    const result = await new AudibleService().searchByAuthorAsin('J.R.R. Tolkien', AUTHOR, 2);

    expect(result.books).toEqual([]);
    expect(result.hasMore).toBe(true);
  });

  it('ends paging on the last raw page', async () => {
    const result = await new AudibleService().searchByAuthorAsin('J.R.R. Tolkien', AUTHOR, 3);

    expect(result.books.map((b) => b.asin)).toEqual(['B0PAGE3001', 'B0PAGE3002']);
    expect(result.hasMore).toBe(false);
  });

  it('without a total, keeps paging while Audible returns full pages', async () => {
    serveCatalog({ 0: { products: filler('B0NOTOT', 50, (a) => product(a, NAMESAKE)), total_results: 0 } });

    const result = await new AudibleService().searchByAuthorAsin('J.R.R. Tolkien', AUTHOR, 1);

    expect(result.books).toEqual([]);
    expect(result.hasMore).toBe(true);
  });

  it('stops at an empty raw page even when the total says there is more', async () => {
    serveCatalog({ 0: { products: [], total_results: 900 } });

    const result = await new AudibleService().searchByAuthorAsin('J.R.R. Tolkien', AUTHOR, 1);

    expect(result.hasMore).toBe(false);
  });

  it('stops at the page cap when the total keeps claiming more', async () => {
    const page = { products: filler('B0CAP', 50, (a) => product(a, NAMESAKE)), total_results: 1_000_000 };
    clientMock.get.mockResolvedValue({ data: page });
    const service = new AudibleService();

    expect((await service.searchByAuthorAsin('J.R.R. Tolkien', AUTHOR, AUDIBLE_MAX_AUTHOR_PAGES - 1)).hasMore).toBe(true);
    expect((await service.searchByAuthorAsin('J.R.R. Tolkien', AUTHOR, AUDIBLE_MAX_AUTHOR_PAGES)).hasMore).toBe(false);
  });
});

describe('author page route paging (#310)', () => {
  const get = async (page: number) => {
    const req = new NextRequest(`http://localhost/api/authors/${AUTHOR}/books?name=J.R.R.%20Tolkien&page=${page}`);
    const res = await GET(req, { params: Promise.resolve({ asin: AUTHOR }) });
    return res.json();
  };

  it('reaches every book on page 3 through a page with no matching books', async () => {
    const p1 = await get(1);
    const p2 = await get(2);
    const p3 = await get(3);

    expect(p1.books.map((b: { asin: string }) => b.asin)).toEqual(['B0PAGE1001']);
    expect(p1.hasMore).toBe(true);
    expect(p2.books).toEqual([]);
    expect(p2.hasMore).toBe(true);
    expect(p3.books.map((b: { asin: string }) => b.asin)).toEqual(['B0PAGE3001', 'B0PAGE3002']);
    expect(p3.hasMore).toBe(false);
  });
});

describe('watched-author scan paging (#310)', () => {
  it('reads past a page with no matching books and finishes the catalog', async () => {
    const { books, complete } = await run(scanAuthorBooks('J.R.R. Tolkien', AUTHOR, log));

    expect(books.map((b) => b.asin)).toEqual(['B0PAGE1001', 'B0PAGE3001', 'B0PAGE3002']);
    expect(complete).toBe(true);
    expect(clientMock.get).toHaveBeenCalledTimes(3);
  });
});
