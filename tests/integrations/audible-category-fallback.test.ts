/**
 * Component: Audible Category Catalog Fallback Tests
 * Documentation: documentation/integrations/audible.md
 *
 * getCategoryBooks scrapes the storefront; when that yields no books it asks the catalog
 * API for the category's bestsellers, in the region's language. Mocked clients only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudibleService } from '@/lib/integrations/audible.service';

const htmlClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const apiClientMock = vi.hoisted(() => ({ get: vi.fn() }));
const axiosMock = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
// Plain holder: the config's mockReset clears vi.fn implementations per test
const state = vi.hoisted(() => ({ region: 'us' }));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ getAudibleRegion: async () => state.region }),
}));

/** Literature & Fiction > Horror on audible.com (tests/fixtures/audible-catalog/us-categories-two-levels.json) */
const HORROR = '18574490011';

const product = (asin: string, language: string | undefined = 'english') => ({
  asin,
  title: `Title ${asin}`,
  authors: [{ asin: 'A000000001', name: 'An Author' }],
  ...(language !== undefined && { language }),
});
const products = (list: object[]) => ({ data: { products: list, total_results: 1000 } });
const fullPage = (prefix: string) => Array.from({ length: 50 }, (_, i) => product(`${prefix}${String(i).padStart(4, '0')}`));
const emptyStorefront = { data: '<html><body><p>No results</p></body></html>' };
const storefrontWithOneBook = {
  data: `<html><body><div class="s-result-item"><ul><li data-asin="BSTORE0001">
    <h2><a href="/pd/x/BSTORE0001">Storefront Book</a></h2><a href="/author/x/A000000001">An Author</a>
  </li></ul></div></body></html>`,
};
const unavailable = () => Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } });

function newService(): AudibleService {
  const service = new AudibleService();
  // Retry backoff resolves at once
  vi.spyOn(service as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(undefined);
  return service;
}

beforeEach(() => {
  state.region = 'us';
  axiosMock.create.mockReturnValueOnce(htmlClientMock).mockReturnValueOnce(apiClientMock);
});

describe('getCategoryBooks catalog fallback', () => {
  it('asks the catalog API for the bestsellers of a sub-category whose storefront page is empty', async () => {
    htmlClientMock.get.mockResolvedValue(emptyStorefront);
    apiClientMock.get.mockResolvedValue(products([product('BCATALOG01')]));

    const books = await newService().getCategoryBooks(HORROR, 200);

    expect(htmlClientMock.get).toHaveBeenCalledTimes(1);
    expect(apiClientMock.get).toHaveBeenCalledTimes(1);
    const [path, config] = apiClientMock.get.mock.calls[0];
    expect(path).toBe('/1.0/catalog/products');
    expect(config.params).toMatchObject({
      category_id: HORROR,
      products_sort_by: 'BestSellers',
      num_results: 50,
      page: 0,
    });
    expect(config.params.response_groups).toContain('product_attrs');
    expect(books.map((b) => [b.asin, b.title, b.author, b.language])).toEqual([
      ['BCATALOG01', 'Title BCATALOG01', 'An Author', 'english'],
    ]);
  });

  it('falls back after the storefront fails through every retry', async () => {
    htmlClientMock.get.mockRejectedValue(unavailable());
    apiClientMock.get.mockResolvedValue(products([product('BCATALOG02')]));

    const books = await newService().getCategoryBooks('18580606011', 200);

    // First attempt plus the 12 storefront retries, then one catalog call
    expect(htmlClientMock.get).toHaveBeenCalledTimes(13);
    expect(books.map((b) => b.asin)).toEqual(['BCATALOG02']);
  });

  it('keeps only products in the region language: other languages and no language are left out', async () => {
    state.region = 'de';
    htmlClientMock.get.mockResolvedValue(emptyStorefront);
    apiClientMock.get.mockResolvedValue(
      products([
        product('BGERMAN001', 'german'),
        product('BENGLISH01', 'english'),
        product('BNOLANG001', undefined),
        product('BDEUTSCH01', 'Deutsch'),
      ]),
    );

    const books = await newService().getCategoryBooks('18580606011', 200);

    expect(books.map((b) => b.asin)).toEqual(['BGERMAN001', 'BDEUTSCH01']);
  });

  it('pages while pages are full and stops at a short page', async () => {
    htmlClientMock.get.mockResolvedValue(emptyStorefront);
    apiClientMock.get
      .mockResolvedValueOnce(products(fullPage('BFULLA')))
      .mockResolvedValueOnce(products([product('BSHORT0001'), product('BFULLA0000')]));

    const books = await newService().getCategoryBooks('18580606011', 200);

    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(apiClientMock.get.mock.calls.map(([, config]) => config.params.page)).toEqual([0, 1]);
    // The repeated ASIN on page 2 is kept once
    expect(books).toHaveLength(51);
    expect(books[50].asin).toBe('BSHORT0001');
  });

  it('stops at the limit', async () => {
    htmlClientMock.get.mockResolvedValue(emptyStorefront);
    apiClientMock.get.mockResolvedValueOnce(products(fullPage('BFULLA'))).mockResolvedValueOnce(products(fullPage('BFULLB')));

    const books = await newService().getCategoryBooks('18580606011', 60);

    expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    expect(books).toHaveLength(60);
  });

  it('returns an empty list when the catalog call fails too', async () => {
    htmlClientMock.get.mockResolvedValue(emptyStorefront);
    apiClientMock.get.mockRejectedValue(unavailable());

    const books = await newService().getCategoryBooks('18580606011', 200);

    // First attempt plus 5 retries
    expect(apiClientMock.get).toHaveBeenCalledTimes(6);
    expect(books).toEqual([]);
  });

  it('keeps what earlier pages collected when a later catalog page fails', async () => {
    htmlClientMock.get.mockResolvedValue(emptyStorefront);
    apiClientMock.get.mockResolvedValueOnce(products(fullPage('BFULLA'))).mockRejectedValue(unavailable());

    const books = await newService().getCategoryBooks('18580606011', 200);

    expect(books).toHaveLength(50);
  });

  it('does not call the catalog API when the storefront has books', async () => {
    htmlClientMock.get.mockResolvedValue(storefrontWithOneBook);

    const books = await newService().getCategoryBooks('18580606011', 200);

    expect(apiClientMock.get).not.toHaveBeenCalled();
    expect(books.map((b) => b.asin)).toEqual(['BSTORE0001']);
  });
});
