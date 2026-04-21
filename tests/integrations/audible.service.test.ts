/**
 * Component: Audible Integration Service Tests
 * Documentation: documentation/integrations/audible.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudibleService } from '@/lib/integrations/audible.service';
import { AUDIBLE_REGIONS, DEFAULT_AUDIBLE_REGION } from '@/lib/types/audible';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

// Two separate client mocks so we can distinguish htmlClient vs apiClient calls.
const htmlClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const apiClientMock = vi.hoisted(() => ({ get: vi.fn() }));

const axiosMock = vi.hoisted(() => ({
  // First call → htmlClient, second call → apiClient (matches initialize() order).
  create: vi.fn(),
  get: vi.fn(),
}));

const configServiceMock = vi.hoisted(() => ({
  getAudibleRegion: vi.fn(),
}));

vi.mock('axios', () => ({
  default: axiosMock,
  ...axiosMock,
}));

vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => configServiceMock,
}));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

interface ProductOverrides {
  asin?: string;
  title?: string;
  authors?: Array<{ asin?: string; name: string }>;
  narrators?: Array<{ name: string }>;
  publisher_summary?: string;
  merchandising_summary?: string;
  product_images?: Record<string, string>;
  runtime_length_min?: number;
  release_date?: string;
  language?: string;
  rating?: { overall_distribution?: { display_stars?: number } };
  category_ladders?: Array<{ ladder: Array<{ name: string }> }>;
  series?: Array<{ asin?: string; title?: string; sequence?: string }>;
}

function makeProduct(overrides: ProductOverrides = {}): ProductOverrides {
  return {
    asin: 'B000000001',
    title: 'Test Book',
    authors: [{ asin: 'A000000001', name: 'Test Author' }],
    narrators: [{ name: 'Test Narrator' }],
    publisher_summary: 'A plain description.',
    product_images: { '500': 'https://images.example.com/cover.jpg' },
    runtime_length_min: 300,
    release_date: '2024-01-01',
    language: 'english',
    rating: { overall_distribution: { display_stars: 4.5 } },
    ...overrides,
  };
}

function makeProductsResponse(products: ProductOverrides[], totalResults = products.length) {
  return { products, total_results: totalResults };
}

// Produces the value that client.get() should resolve to (the axios response object).
// fetchWithRetry captures this as `response`, then callers do `response.data` to
// unwrap the API envelope. So the mock must be shaped as: { data: <catalog_envelope> }.
function apiResponse(envelope: object) {
  return { data: envelope };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('AudibleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    htmlClientMock.get.mockReset();
    apiClientMock.get.mockReset();
    axiosMock.get.mockReset();
    configServiceMock.getAudibleRegion.mockReset();

    // Default: first create() → htmlClient, second → apiClient.
    axiosMock.create
      .mockReturnValueOnce(htmlClientMock)
      .mockReturnValueOnce(apiClientMock);

    configServiceMock.getAudibleRegion.mockResolvedValue('us');
  });

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  describe('initialization', () => {
    it('calls axios.create twice on first search (htmlClient + apiClient)', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.search('test', 1);

      expect(axiosMock.create).toHaveBeenCalledTimes(2);
    });

    it('creates htmlClient with the region baseUrl', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.search('test', 1);

      expect(axiosMock.create.mock.calls[0][0].baseURL).toBe(AUDIBLE_REGIONS.us.baseUrl);
    });

    it('creates apiClient with the region apiBaseUrl', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.search('test', 1);

      expect(axiosMock.create.mock.calls[1][0].baseURL).toBe(AUDIBLE_REGIONS.us.apiBaseUrl);
    });

    it('does not reinitialize when the region is unchanged between calls', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.search('test', 1);
      await service.search('test', 1);

      // Still only 2 creates total (not 4).
      expect(axiosMock.create).toHaveBeenCalledTimes(2);
    });

    it('reinitializes when the configured region changes between calls', async () => {
      configServiceMock.getAudibleRegion
        .mockResolvedValueOnce('us')
        .mockResolvedValueOnce('uk')
        .mockResolvedValueOnce('uk');

      // Prepare creates for both init cycles.
      axiosMock.create.mockReset();
      axiosMock.create
        .mockReturnValueOnce(htmlClientMock) // first init: htmlClient
        .mockReturnValueOnce(apiClientMock)  // first init: apiClient
        .mockReturnValueOnce(htmlClientMock) // second init: htmlClient
        .mockReturnValueOnce(apiClientMock); // second init: apiClient

      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.search('test', 1);
      await service.search('test', 1);

      expect(axiosMock.create).toHaveBeenCalledTimes(4);
      expect(axiosMock.create.mock.calls[2][0].baseURL).toBe(AUDIBLE_REGIONS.uk.baseUrl);
    });

    it('reinitializes after forceReinitialize() is called', async () => {
      axiosMock.create.mockReset();
      axiosMock.create
        .mockReturnValueOnce(htmlClientMock)
        .mockReturnValueOnce(apiClientMock)
        .mockReturnValueOnce(htmlClientMock)
        .mockReturnValueOnce(apiClientMock);

      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.search('test', 1);
      service.forceReinitialize();
      await service.search('test', 1);

      expect(axiosMock.create).toHaveBeenCalledTimes(4);
    });

    it('falls back to the default US region when config service throws', async () => {
      configServiceMock.getAudibleRegion.mockRejectedValue(new Error('config fail'));
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.search('fallback', 1);

      expect(axiosMock.create.mock.calls[0][0].baseURL).toBe(
        AUDIBLE_REGIONS[DEFAULT_AUDIBLE_REGION].baseUrl,
      );
    });

    it('creates both clients even when config service throws', async () => {
      configServiceMock.getAudibleRegion.mockRejectedValue(new Error('config fail'));
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.search('fallback', 1);

      expect(axiosMock.create).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // search()
  // -------------------------------------------------------------------------

  describe('search()', () => {
    it('sends correct endpoint, keywords, num_results, and response_groups to apiClient', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.search('fantasy', 1);

      expect(apiClientMock.get).toHaveBeenCalledWith(
        '/1.0/catalog/products',
        expect.objectContaining({
          params: expect.objectContaining({
            keywords: 'fantasy',
            num_results: 50,
            response_groups: expect.stringContaining('contributors'),
          }),
        }),
      );
    });

    it('subtracts 1 from public page=1 before calling the API (page offset regression)', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));
      const service = new AudibleService();

      await service.search('test', 1);
      expect(apiClientMock.get.mock.calls[0][1].params.page).toBe(0);
    });

    it('subtracts 1 from public page=2 before calling the API', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));
      const service = new AudibleService();

      await service.search('test', 2);
      expect(apiClientMock.get.mock.calls[0][1].params.page).toBe(1);
    });

    it('subtracts 1 from public page=3 before calling the API', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));
      const service = new AudibleService();

      await service.search('test', 3);
      expect(apiClientMock.get.mock.calls[0][1].params.page).toBe(2);
    });

    it('returns query, results, totalResults, page, and hasMore fields', async () => {
      const products = [makeProduct()];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products, 1)));

      const service = new AudibleService();
      const result = await service.search('test', 1);

      expect(result).toMatchObject({
        query: 'test',
        page: 1,
        totalResults: 1,
        hasMore: false,
      });
      expect(result.results).toHaveLength(1);
    });

    it('sets hasMore=true when totalResults exceeds page * pageSize', async () => {
      const products = Array.from({ length: 50 }, (_, i) =>
        makeProduct({ asin: `B${String(i).padStart(9, '0')}`, title: `Book ${i}` }),
      );
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products, 150)));

      const service = new AudibleService();
      const result = await service.search('test', 1);

      expect(result.hasMore).toBe(true);
    });

    it('sets hasMore=false when all results fit on the current page', async () => {
      const products = [makeProduct()];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products, 1)));

      const service = new AudibleService();
      const result = await service.search('test', 1);

      expect(result.hasMore).toBe(false);
    });

    it('returns empty results on error without throwing', async () => {
      const error: Error & { response?: { status: number } } = new Error('Not Found');
      error.response = { status: 404 };
      apiClientMock.get.mockRejectedValue(error);

      const service = new AudibleService();
      const result = await service.search('oops', 1);

      expect(result.results).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.totalResults).toBe(0);
    });

    it('uses apiClient (not htmlClient) for catalog requests', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.search('test', 1);

      expect(apiClientMock.get).toHaveBeenCalled();
      expect(htmlClientMock.get).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // mapCatalogProduct correctness (tested via search())
  // -------------------------------------------------------------------------

  describe('mapCatalogProduct field mapping', () => {
    it('maps asin and title from catalog product', async () => {
      const products = [makeProduct({ asin: 'B000AAABBB', title: 'My Great Book' })];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].asin).toBe('B000AAABBB');
      expect(results[0].title).toBe('My Great Book');
    });

    it('joins multiple author names with a comma and maps first author asin', async () => {
      const products = [
        makeProduct({
          authors: [
            { asin: 'A111', name: 'First Author' },
            { asin: 'A222', name: 'Second Author' },
          ],
        }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].author).toBe('First Author, Second Author');
      expect(results[0].authorAsin).toBe('A111');
    });

    it('joins multiple narrator names with a comma', async () => {
      const products = [
        makeProduct({
          narrators: [{ name: 'Narrator A' }, { name: 'Narrator B' }],
        }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].narrator).toBe('Narrator A, Narrator B');
    });

    it('sets narrator to undefined when narrators array is absent', async () => {
      const { narrators: _n, ...base } = makeProduct();
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([base])));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].narrator).toBeUndefined();
    });

    it('strips HTML tags and entities from publisher_summary to produce plain text description', async () => {
      const products = [
        makeProduct({
          // Use a space before <br/> so whitespace is preserved after tag removal.
          publisher_summary:
            '<p>A &amp; B book with&nbsp;smart text. <br/>More here.</p>',
        }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].description).toBe('A & B book with smart text. More here.');
    });

    it('falls back to merchandising_summary when publisher_summary is absent', async () => {
      const { publisher_summary: _p, ...base } = makeProduct();
      const products = [{ ...base, merchandising_summary: 'Merchandising text.' }];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].description).toBe('Merchandising text.');
    });

    it('sets description to undefined when both summary fields are absent', async () => {
      const { publisher_summary: _p, ...base } = makeProduct();
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([base])));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].description).toBeUndefined();
    });

    it('maps coverArtUrl from product_images["500"]', async () => {
      const products = [
        makeProduct({ product_images: { '500': 'https://images.example.com/cover500.jpg' } }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].coverArtUrl).toBe('https://images.example.com/cover500.jpg');
    });

    it('sets coverArtUrl to undefined when product_images is absent', async () => {
      const { product_images: _pi, ...base } = makeProduct();
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([base])));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].coverArtUrl).toBeUndefined();
    });

    it('maps durationMinutes from runtime_length_min', async () => {
      const products = [makeProduct({ runtime_length_min: 480 })];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].durationMinutes).toBe(480);
    });

    it('maps releaseDate from release_date', async () => {
      const products = [makeProduct({ release_date: '2023-06-15' })];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].releaseDate).toBe('2023-06-15');
    });

    it('maps rating from rating.overall_distribution.display_stars', async () => {
      const products = [
        makeProduct({ rating: { overall_distribution: { display_stars: 4.7 } } }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].rating).toBe(4.7);
    });

    it('sets rating to undefined when rating field is absent', async () => {
      const { rating: _r, ...base } = makeProduct();
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([base])));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].rating).toBeUndefined();
    });

    it('flattens, deduplicates, and caps genres at 5 from category_ladders', async () => {
      const products = [
        makeProduct({
          category_ladders: [
            { ladder: [{ name: 'Fiction' }, { name: 'Fantasy' }, { name: 'Epic Fantasy' }] },
            { ladder: [{ name: 'Fiction' }, { name: 'Adventure' }] }, // "Fiction" is a duplicate
            { ladder: [{ name: 'Young Adult' }, { name: 'Coming of Age' }] },
          ],
        }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      // After dedupe: Fiction, Fantasy, Epic Fantasy, Adventure, Young Adult, Coming of Age = 6 → capped at 5
      expect(results[0].genres).toHaveLength(5);
      expect(results[0].genres).not.toContain('Coming of Age');
      // Duplicates removed
      const genreSet = new Set(results[0].genres);
      expect(genreSet.size).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // Series selection rules
  // -------------------------------------------------------------------------

  describe('series selection', () => {
    it('picks the series entry that has a non-empty sequence (even if not first)', async () => {
      const products = [
        makeProduct({
          series: [
            { asin: 'S000', title: 'Wrong Series', sequence: '' },
            { asin: 'S001', title: 'Right Series', sequence: '3' },
          ],
        }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].series).toBe('Right Series');
      expect(results[0].seriesAsin).toBe('S001');
      expect(results[0].seriesPart).toBe('3');
    });

    it('falls back to series[0] when all sequence values are empty', async () => {
      const products = [
        makeProduct({
          series: [
            { asin: 'S010', title: 'Fallback Series', sequence: '' },
            { asin: 'S011', title: 'Other Series', sequence: '' },
          ],
        }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].series).toBe('Fallback Series');
      expect(results[0].seriesPart).toBeUndefined();
    });

    it('leaves all series fields undefined when series array is absent', async () => {
      const { series: _s, ...base } = makeProduct();
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([base])));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].series).toBeUndefined();
      expect(results[0].seriesPart).toBeUndefined();
      expect(results[0].seriesAsin).toBeUndefined();
    });

    it('extracts leading numeric part from a compound sequence string like "2, Dramatized Adaptation"', async () => {
      const products = [
        makeProduct({
          series: [{ asin: 'S020', title: 'Drama Series', sequence: '2, Dramatized Adaptation' }],
        }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].seriesPart).toBe('2');
    });

    it('preserves decimal sequence values like "1.5"', async () => {
      const products = [
        makeProduct({
          series: [{ asin: 'S021', title: 'Decimal Series', sequence: '1.5' }],
        }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].seriesPart).toBe('1.5');
    });

    it('keeps non-numeric sequence text as-is when there are no digits (e.g. "Prequel")', async () => {
      const products = [
        makeProduct({
          series: [{ asin: 'S022', title: 'Prequel Series', sequence: 'Prequel' }],
        }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products)));

      const service = new AudibleService();
      const { results } = await service.search('test', 1);

      expect(results[0].seriesPart).toBe('Prequel');
    });
  });

  // -------------------------------------------------------------------------
  // searchByAuthorAsin()
  // -------------------------------------------------------------------------

  describe('searchByAuthorAsin()', () => {
    it('sends author name (not ASIN) as the author param', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.searchByAuthorAsin('Brandon Sanderson', 'A000AUTHOR', 1);

      expect(apiClientMock.get.mock.calls[0][1].params.author).toBe('Brandon Sanderson');
    });

    it('subtracts 1 from public page=1 before calling the API', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));
      const service = new AudibleService();

      await service.searchByAuthorAsin('Test Author', 'AASIN', 1);
      expect(apiClientMock.get.mock.calls[0][1].params.page).toBe(0);
    });

    it('subtracts 1 from public page=2 before calling the API', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));
      const service = new AudibleService();

      await service.searchByAuthorAsin('Test Author', 'AASIN', 2);
      expect(apiClientMock.get.mock.calls[0][1].params.page).toBe(1);
    });

    it('filters out products whose authors array does not contain the target ASIN', async () => {
      const matchingAsin = 'A000AUTHOR';
      const products = [
        makeProduct({ asin: 'B001', authors: [{ asin: matchingAsin, name: 'Author' }], language: 'english' }),
        makeProduct({ asin: 'B002', authors: [{ asin: 'A999OTHER', name: 'Other' }], language: 'english' }),
        makeProduct({ asin: 'B003', authors: [{ asin: matchingAsin, name: 'Author' }], language: 'english' }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products, 3)));

      const service = new AudibleService();
      const result = await service.searchByAuthorAsin('Author', matchingAsin, 1);

      expect(result.books).toHaveLength(2);
      expect(result.books.map((b) => b.asin)).toEqual(['B001', 'B003']);
    });

    it('filters out products whose language does not match the region accepted values', async () => {
      const matchingAsin = 'A000AUTHOR';
      const products = [
        makeProduct({ asin: 'B004', authors: [{ asin: matchingAsin, name: 'Author' }], language: 'english' }),
        makeProduct({ asin: 'B005', authors: [{ asin: matchingAsin, name: 'Author' }], language: 'spanish' }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products, 2)));

      const service = new AudibleService();
      // US region only accepts 'english'
      const result = await service.searchByAuthorAsin('Author', matchingAsin, 1);

      expect(result.books).toHaveLength(1);
      expect(result.books[0].asin).toBe('B004');
    });

    it('applies both ASIN and language filters together (AND logic)', async () => {
      const matchingAsin = 'A000AUTHOR';
      const products = [
        // passes both
        makeProduct({ asin: 'B006', authors: [{ asin: matchingAsin, name: 'Author' }], language: 'english' }),
        // wrong ASIN
        makeProduct({ asin: 'B007', authors: [{ asin: 'A999OTHER', name: 'Other' }], language: 'english' }),
        // wrong language
        makeProduct({ asin: 'B008', authors: [{ asin: matchingAsin, name: 'Author' }], language: 'spanish' }),
        // wrong ASIN + wrong language
        makeProduct({ asin: 'B009', authors: [{ asin: 'A999OTHER', name: 'Other' }], language: 'spanish' }),
      ];
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse(products, 4)));

      const service = new AudibleService();
      const result = await service.searchByAuthorAsin('Author', matchingAsin, 1);

      expect(result.books).toHaveLength(1);
      expect(result.books[0].asin).toBe('B006');
    });
  });

  // -------------------------------------------------------------------------
  // getPopularAudiobooks()
  // -------------------------------------------------------------------------

  describe('getPopularAudiobooks()', () => {
    it('uses products_sort_by: BestSellers', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.getPopularAudiobooks(1);

      expect(apiClientMock.get.mock.calls[0][1].params.products_sort_by).toBe('BestSellers');
    });

    it('subtracts 1 from public page=1 before calling the API', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));
      const service = new AudibleService();
      const delaySpy = vi.spyOn(service as any, 'delay').mockResolvedValue(undefined);

      await service.getPopularAudiobooks(1);
      expect(apiClientMock.get.mock.calls[0][1].params.page).toBe(0);
      delaySpy.mockRestore();
    });

    it('makes a second call with page=1 when paginating to page 2', async () => {
      const page1Products = Array.from({ length: 50 }, (_, i) =>
        makeProduct({ asin: `B${String(i).padStart(9, '0')}`, title: `Book ${i}` }),
      );
      const page2Products = Array.from({ length: 25 }, (_, i) =>
        makeProduct({ asin: `B${String(i + 50).padStart(9, '0')}`, title: `Book ${i + 50}` }),
      );

      apiClientMock.get
        .mockResolvedValueOnce(apiResponse(makeProductsResponse(page1Products, 75)))
        .mockResolvedValueOnce(apiResponse(makeProductsResponse(page2Products, 75)));

      const service = new AudibleService();
      const delaySpy = vi.spyOn(service as any, 'delay').mockResolvedValue(undefined);

      await service.getPopularAudiobooks(75);

      expect(apiClientMock.get.mock.calls[1][1].params.page).toBe(1);
      delaySpy.mockRestore();
    });

    it('paginates and returns up to the requested limit', async () => {
      const page1Products = Array.from({ length: 50 }, (_, i) =>
        makeProduct({ asin: `B${String(i).padStart(9, '0')}`, title: `Book ${i}` }),
      );
      const page2Products = Array.from({ length: 25 }, (_, i) =>
        makeProduct({ asin: `B${String(i + 50).padStart(9, '0')}`, title: `Book ${i + 50}` }),
      );

      apiClientMock.get
        .mockResolvedValueOnce(apiResponse(makeProductsResponse(page1Products, 75)))
        .mockResolvedValueOnce(apiResponse(makeProductsResponse(page2Products, 75)));

      const service = new AudibleService();
      const delaySpy = vi.spyOn(service as any, 'delay').mockResolvedValue(undefined);
      const results = await service.getPopularAudiobooks(75);

      expect(results).toHaveLength(75);
      delaySpy.mockRestore();
    });

    it('stops early when a page returns fewer than the page size', async () => {
      const products = [makeProduct()];
      apiClientMock.get.mockResolvedValueOnce(apiResponse(makeProductsResponse(products, 1)));

      const service = new AudibleService();
      const results = await service.getPopularAudiobooks(50);

      expect(results).toHaveLength(1);
      expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    });

    it('deduplicates by ASIN across pages', async () => {
      const sharedProduct = makeProduct({ asin: 'BDUP000001', title: 'Duplicated Book' });
      const uniqueProduct = makeProduct({ asin: 'BUNIQ000001', title: 'Unique Book' });

      apiClientMock.get
        .mockResolvedValueOnce(
          apiResponse(makeProductsResponse([sharedProduct], 51)),
        )
        .mockResolvedValueOnce(
          // page 2 returns the same ASIN plus a new one
          apiResponse(makeProductsResponse([sharedProduct, uniqueProduct], 51)),
        );

      const service = new AudibleService();
      const delaySpy = vi.spyOn(service as any, 'delay').mockResolvedValue(undefined);
      const results = await service.getPopularAudiobooks(100);

      const asins = results.map((r) => r.asin);
      expect(asins.filter((a) => a === 'BDUP000001')).toHaveLength(1);
      delaySpy.mockRestore();
    });

    it('returns empty array on error without throwing', async () => {
      const error: Error & { response?: { status: number } } = new Error('Not Found');
      error.response = { status: 404 };
      apiClientMock.get.mockRejectedValue(error);

      const service = new AudibleService();
      const results = await service.getPopularAudiobooks(5);

      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getNewReleases()
  // -------------------------------------------------------------------------

  describe('getNewReleases()', () => {
    it('uses products_sort_by: -ReleaseDate', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.getNewReleases(1);

      expect(apiClientMock.get.mock.calls[0][1].params.products_sort_by).toBe('-ReleaseDate');
    });

    it('subtracts 1 from public page=1 before calling the API', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));
      const service = new AudibleService();
      const delaySpy = vi.spyOn(service as any, 'delay').mockResolvedValue(undefined);

      await service.getNewReleases(1);
      expect(apiClientMock.get.mock.calls[0][1].params.page).toBe(0);
      delaySpy.mockRestore();
    });

    it('subtracts 1 from public page=2 when paginating to the second page', async () => {
      const page1Products = Array.from({ length: 50 }, (_, i) =>
        makeProduct({ asin: `B${String(i).padStart(9, '0')}` }),
      );
      const page2Products = [makeProduct({ asin: 'BNEW000099' })];

      apiClientMock.get
        .mockResolvedValueOnce(apiResponse(makeProductsResponse(page1Products, 51)))
        .mockResolvedValueOnce(apiResponse(makeProductsResponse(page2Products, 51)));

      const service = new AudibleService();
      const delaySpy = vi.spyOn(service as any, 'delay').mockResolvedValue(undefined);

      await service.getNewReleases(51);
      expect(apiClientMock.get.mock.calls[1][1].params.page).toBe(1);
      delaySpy.mockRestore();
    });

    it('deduplicates by ASIN across pages', async () => {
      const sharedProduct = makeProduct({ asin: 'BDUP000002' });
      apiClientMock.get
        .mockResolvedValueOnce(apiResponse(makeProductsResponse([sharedProduct], 51)))
        .mockResolvedValueOnce(apiResponse(makeProductsResponse([sharedProduct], 51)));

      const service = new AudibleService();
      const delaySpy = vi.spyOn(service as any, 'delay').mockResolvedValue(undefined);
      const results = await service.getNewReleases(100);

      expect(results.filter((r) => r.asin === 'BDUP000002')).toHaveLength(1);
      delaySpy.mockRestore();
    });

    it('returns empty array on error without throwing', async () => {
      const error: Error & { response?: { status: number } } = new Error('Not Found');
      error.response = { status: 404 };
      apiClientMock.get.mockRejectedValue(error);

      const service = new AudibleService();
      const results = await service.getNewReleases(5);

      expect(results).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getCategoryBooks()
  // -------------------------------------------------------------------------

  describe('getCategoryBooks()', () => {
    it('sends category_id and BestSellers sort param', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));

      const service = new AudibleService();
      await service.getCategoryBooks('18685580011', 1);

      const params = apiClientMock.get.mock.calls[0][1].params;
      expect(params.category_id).toBe('18685580011');
      expect(params.products_sort_by).toBe('BestSellers');
    });

    it('subtracts 1 from public page=1 before calling the API', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse(makeProductsResponse([])));
      const service = new AudibleService();
      const delaySpy = vi.spyOn(service as any, 'delay').mockResolvedValue(undefined);

      await service.getCategoryBooks('CAT001', 1);
      expect(apiClientMock.get.mock.calls[0][1].params.page).toBe(0);
      delaySpy.mockRestore();
    });

    it('subtracts 1 from public page=2 when paginating to the second page', async () => {
      const page1Products = Array.from({ length: 50 }, (_, i) =>
        makeProduct({ asin: `B${String(i).padStart(9, '0')}` }),
      );
      const page2Products = [makeProduct({ asin: 'BCAT000099' })];

      apiClientMock.get
        .mockResolvedValueOnce(apiResponse(makeProductsResponse(page1Products, 51)))
        .mockResolvedValueOnce(apiResponse(makeProductsResponse(page2Products, 51)));

      const service = new AudibleService();
      const delaySpy = vi.spyOn(service as any, 'delay').mockResolvedValue(undefined);

      await service.getCategoryBooks('CAT001', 51);
      expect(apiClientMock.get.mock.calls[1][1].params.page).toBe(1);
      delaySpy.mockRestore();
    });

    it('deduplicates by ASIN across pages', async () => {
      const sharedProduct = makeProduct({ asin: 'BDUP000003' });
      apiClientMock.get
        .mockResolvedValueOnce(apiResponse(makeProductsResponse([sharedProduct], 51)))
        .mockResolvedValueOnce(apiResponse(makeProductsResponse([sharedProduct], 51)));

      const service = new AudibleService();
      const delaySpy = vi.spyOn(service as any, 'delay').mockResolvedValue(undefined);
      const results = await service.getCategoryBooks('CAT001', 100);

      expect(results.filter((r) => r.asin === 'BDUP000003')).toHaveLength(1);
      delaySpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // getCategories()
  // -------------------------------------------------------------------------

  describe('getCategories()', () => {
    it('hits /1.0/catalog/categories and maps top-level categories to id+name', async () => {
      apiClientMock.get.mockResolvedValue(
        apiResponse({
          categories: [
            { id: '18685580011', name: 'Science Fiction & Fantasy' },
            { id: '18685812011', name: 'Mystery, Thriller & Suspense' },
          ],
        }),
      );

      const service = new AudibleService();
      const categories = await service.getCategories();

      expect(apiClientMock.get).toHaveBeenCalledWith('/1.0/catalog/categories', expect.anything());
      expect(categories).toHaveLength(2);
      expect(categories[0]).toEqual({ id: '18685580011', name: 'Science Fiction & Fantasy' });
    });

    it('returns empty array when categories field is missing', async () => {
      apiClientMock.get.mockResolvedValue(apiResponse({}));

      const service = new AudibleService();
      const categories = await service.getCategories();

      expect(categories).toEqual([]);
    });

    it('returns empty array on error without throwing', async () => {
      const error: Error & { response?: { status: number } } = new Error('Not Found');
      error.response = { status: 404 };
      apiClientMock.get.mockRejectedValue(error);

      const service = new AudibleService();
      const categories = await service.getCategories();

      expect(categories).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getAudiobookDetails() — Audnexus primary + catalog fallback
  // -------------------------------------------------------------------------

  describe('getAudiobookDetails()', () => {
    it('returns Audnexus data directly when Audnexus succeeds', async () => {
      axiosMock.get.mockResolvedValueOnce({
        data: {
          title: 'Audnexus Book',
          authors: [{ name: 'Author A', asin: 'A111' }],
          narrators: [{ name: 'Narrator A' }],
          description: 'A fine description.',
          image: 'https://images.example.com/cover._SL500_.jpg',
          runtimeLengthMin: '300',
          genres: ['Fiction'],
          rating: '4.7',
        },
      });

      const service = new AudibleService();
      const details = await service.getAudiobookDetails('B000AAAAAA');

      expect(details?.title).toBe('Audnexus Book');
      expect(details?.author).toBe('Author A');
      expect(details?.durationMinutes).toBe(300);
      // Catalog API should NOT be called when Audnexus succeeds.
      expect(apiClientMock.get).not.toHaveBeenCalled();
    });

    it('falls back to the catalog API when Audnexus returns 404', async () => {
      axiosMock.get.mockRejectedValueOnce({ response: { status: 404 }, message: 'Not found' });

      const product = makeProduct({ asin: 'B000BBBBBB', title: 'Catalog Book' });
      apiClientMock.get.mockResolvedValue(
        apiResponse({ product }),
      );

      const service = new AudibleService();
      const details = await service.getAudiobookDetails('B000BBBBBB');

      expect(details?.title).toBe('Catalog Book');
      expect(apiClientMock.get).toHaveBeenCalled();
    });

    it('returns null when the catalog API returns a stub body (product.title missing)', async () => {
      axiosMock.get.mockRejectedValueOnce({ response: { status: 404 }, message: 'Not found' });

      // Stub body: asin present but no title
      apiClientMock.get.mockResolvedValue(
        apiResponse({ product: { asin: 'B000STUB01' } }),
      );

      const service = new AudibleService();
      const details = await service.getAudiobookDetails('B000STUB01');

      expect(details).toBeNull();
    });

    it('returns null when both Audnexus and the catalog API fail', async () => {
      axiosMock.get.mockRejectedValueOnce({ response: { status: 404 }, message: 'Not found' });
      // Use a non-retryable 404 so the test does not incur retry delays.
      const error: Error & { response?: { status: number } } = new Error('Not Found');
      error.response = { status: 404 };
      apiClientMock.get.mockRejectedValue(error);

      const service = new AudibleService();
      const details = await service.getAudiobookDetails('B000FAIL01');

      expect(details).toBeNull();
    });

    it('returns null when fetchAudibleDetailsFromApi throws unexpectedly', async () => {
      axiosMock.get.mockRejectedValueOnce({ response: { status: 404 }, message: 'Not found' });

      const service = new AudibleService();
      vi.spyOn(service as any, 'fetchAudibleDetailsFromApi').mockRejectedValue(
        new Error('unexpected boom'),
      );

      const result = await service.getAudiobookDetails('B000TEST');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getRuntime()
  // -------------------------------------------------------------------------

  describe('getRuntime()', () => {
    it('returns runtime in minutes from Audnexus runtimeLengthMin', async () => {
      axiosMock.get.mockResolvedValue({ data: { runtimeLengthMin: '480' } });

      const service = new AudibleService();
      const runtime = await service.getRuntime('B000123456');

      expect(runtime).toBe(480);
    });

    it('returns null when Audnexus returns 404', async () => {
      axiosMock.get.mockRejectedValue({ response: { status: 404 }, message: 'Not found' });

      const service = new AudibleService();
      const runtime = await service.getRuntime('B000404404');

      expect(runtime).toBeNull();
    });

    it('returns null when Audnexus errors unexpectedly', async () => {
      axiosMock.get.mockRejectedValue({ response: { status: 500 }, message: 'Boom' });

      const service = new AudibleService();
      // Suppress retry delays so the test runs instantly.
      const delaySpy = vi.spyOn(service as any, 'delay').mockResolvedValue(undefined);
      const runtime = await service.getRuntime('B000500500');

      expect(runtime).toBeNull();
      delaySpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // fetch() public wrapper — must use htmlClient
  // -------------------------------------------------------------------------

  describe('fetch() public wrapper', () => {
    it('routes through htmlClient so audible-series.ts callers continue to work', async () => {
      htmlClientMock.get.mockResolvedValue({ data: '<html>test</html>' });

      const service = new AudibleService();
      await service.fetch('/some-path');

      expect(htmlClientMock.get).toHaveBeenCalledWith('/some-path', expect.anything());
      expect(apiClientMock.get).not.toHaveBeenCalled();
    });
  });
});
