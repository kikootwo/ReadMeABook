/**
 * Component: Audible Series Search Ranking Tests
 * Documentation: documentation/integrations/audible-series-search.md
 *
 * Positions come from recorded catalog keyword pages (tests/fixtures/audible-catalog):
 * US "expeditionary force" (50 products, 18 series) and UK "cosmere" (50 products:
 * 29 English, 19 Spanish, 2 with no language; 14 series). Inline products are labelled.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCatalog, loadCatalogFixture } from '../helpers/fake-audible-catalog';

vi.mock('@/lib/integrations/audible.service', async () => (await import('../helpers/fake-audible-catalog')).audibleServiceModule);

const EF_PAGE = 'us-keywords-expeditionary-force.json';
const COSMERE_PAGE = 'uk-keywords-cosmere.json';

async function search(query: string, region: string, page: unknown, options?: { languageFilter?: boolean }) {
  fakeCatalog.region = region;
  fakeCatalog.keyword = async () => page;
  const { searchForSeries } = await import('@/lib/integrations/audible-series');
  return searchForSeries(query, options);
}

const titles = (results: Array<{ title: string }>) => results.map((r) => r.title);

const EF_ORDER = [
  'Expeditionary Force',
  'Expeditionary Force Mavericks',
  'War Core',
  'Throne of Glass',
  'The Dispatcher',
  'Sun Eater',
  'The Cosmere',
  'Elantris',
  'Dungeon Crawler Carl',
  'Empire of the Vampire',
  'The Ender Saga',
  'The Enderverse',
  'Extreme Ownership',
  'Convergence',
  'Exodus',
];

beforeEach(() => {
  fakeCatalog.reset();
});

describe('series search ranking on recorded catalog pages', () => {
  it('ranks "expeditionary force" (us) by title match, then product count, then first seen, capped at 15', async () => {
    const results = await search('expeditionary force', 'us', loadCatalogFixture(EF_PAGE));

    // 18 series on the page: Jack Reacher, The Inheritance Cycle and Demon Accords Generations fall past the cap
    expect(titles(results)).toEqual(EF_ORDER);
  });

  it('matches a half-typed last word as a prefix ("expeditionary fo")', async () => {
    const results = await search('expeditionary fo', 'us', loadCatalogFixture(EF_PAGE));

    expect(titles(results)).toEqual(EF_ORDER);
  });

  it('keeps every series on a de store when all products are English, in the same order', async () => {
    const results = await search('expeditionary force', 'de', loadCatalogFixture(EF_PAGE));

    expect(titles(results)).toEqual(EF_ORDER);
  });

  it('ranks "cosmere" (uk): equal matches go to the English edition first, Spanish series stay', async () => {
    const results = await search('cosmere', 'uk', loadCatalogFixture(COSMERE_PAGE));

    expect(results).toHaveLength(14);
    expect(titles(results)).toEqual([
      'The Cosmere',
      'The Cosmere (Spanish Edition)',
      'Secret Projects',
      'The Mistborn Saga',
      'The Stormlight Archive',
      'Elantris',
      'Cosmos',
      'Wax and Wayne',
      'Strata Wars',
      'El Archivo de las Tormentas',
      'Trilog\u00eda Original Mistborn',
      'Wax & Wayne [Spanish Edition]',
      'Novela Secreta',
      'Elantris [Spanish Edition]',
    ]);
  });

  it('leaves stop words out of the match ("the cosmere" ranks like "cosmere")', async () => {
    const results = await search('the cosmere', 'uk', loadCatalogFixture(COSMERE_PAGE));

    expect(titles(results).slice(0, 3)).toEqual(['The Cosmere', 'The Cosmere (Spanish Edition)', 'Secret Projects']);
  });

  it('puts a matching other-language series above unmatched English ones ("mistborn", uk)', async () => {
    const results = await search('mistborn', 'uk', loadCatalogFixture(COSMERE_PAGE));

    expect(titles(results).slice(0, 3)).toEqual(['The Mistborn Saga', 'Trilog\u00eda Original Mistborn', 'The Cosmere']);
  });

  it('keeps an exact English match above unrelated German series on a de store (synthetic German products)', async () => {
    const page = loadCatalogFixture(EF_PAGE);
    page.products = [
      ...page.products.slice(0, 25),
      // Synthetic: two German products whose series match no query word
      { asin: 'X000000001', language: 'german', series: [{ asin: 'GER0000001', title: 'Perry Rhodan' }] },
      { asin: 'X000000002', language: 'german', series: [{ asin: 'GER0000002', title: 'Die Expedition' }] },
    ];

    const results = await search('expeditionary force', 'de', page);

    expect(titles(results)).toEqual(['Expeditionary Force', 'Expeditionary Force Mavericks', 'Perry Rhodan', 'Die Expedition']);
  });

  it('with the language filter on, drops series that only have other-language products', async () => {
    const page = loadCatalogFixture(COSMERE_PAGE);
    // Synthetic: a product with no language is never treated as foreign
    page.products.push({ asin: 'X000000003', series: [{ asin: 'NOLANG0001', title: 'Cosmere Companion' }] });

    const results = await search('cosmere', 'uk', page, { languageFilter: true });

    expect(titles(results)).toEqual([
      'The Cosmere',
      'Cosmere Companion',
      'Secret Projects',
      'The Mistborn Saga',
      'The Stormlight Archive',
      'Elantris',
      'Cosmos',
      'Wax and Wayne',
      'Strata Wars',
    ]);
  });

  it('matches every word but the last as a whole word (synthetic: "king chronicle")', async () => {
    const page = {
      products: [
        { asin: 'X000000011', language: 'english', series: [{ asin: 'KINGKILLER', title: 'The Kingkiller Chronicle' }] },
        { asin: 'X000000012', language: 'english', series: [{ asin: 'KINGKILLER', title: 'The Kingkiller Chronicle' }] },
        { asin: 'X000000013', language: 'english', series: [{ asin: 'KINGCHRONI', title: 'The King Chronicle' }] },
      ],
    };

    const results = await search('king chronicle', 'us', page);

    expect(titles(results)).toEqual(['The King Chronicle', 'The Kingkiller Chronicle']);
  });
});

describe('series search card fields', () => {
  it('uses the cover of the lowest-numbered book and links to the region store read after the call', async () => {
    fakeCatalog.keyword = async () => {
      // The first catalog call initializes the service for the configured region
      fakeCatalog.region = 'uk';
      fakeCatalog.baseUrl = 'https://www.audible.co.uk';
      return loadCatalogFixture(EF_PAGE);
    };
    const { searchForSeries } = await import('@/lib/integrations/audible-series');

    const results = await searchForSeries('expeditionary force');

    // "Columbus Day" (#1), not "Last Ride" (#20, first on the page)
    expect(results[0].coverArtUrl).toBe('https://m.media-amazon.com/images/I/51NDcPX7W8L._SL500_.jpg');
    expect(results[1].coverArtUrl).toBe('https://m.media-amazon.com/images/I/510+rMBc+EL._SL500_.jpg');
    expect(results[0].audibleUrl).toBe('https://www.audible.co.uk/series/B01N9CUGHG');
  });

  it('prefers a cover from a product in the region language (synthetic)', async () => {
    const page = {
      products: [
        { asin: 'X000000021', language: 'spanish', product_images: { 500: 'https://img.example/es.jpg' }, series: [{ asin: 'MIXEDSER01', title: 'Mixed', sequence: '1' }] },
        { asin: 'X000000022', language: 'english', product_images: { 500: 'https://img.example/en.jpg' }, series: [{ asin: 'MIXEDSER01', title: 'Mixed', sequence: '3' }] },
      ],
    };

    const results = await search('mixed', 'us', page);

    expect(results[0].coverArtUrl).toBe('https://img.example/en.jpg');
  });

  it('tags a series with its books\' most specific genres, most frequent first (synthetic ladders)', async () => {
    const ladder = (...names: string[]) => ({ ladder: names.map((name) => ({ name })) });
    const page = {
      products: [
        {
          asin: 'X000000031',
          language: 'english',
          category_ladders: [ladder('Science Fiction & Fantasy', 'Fantasy', 'Epic'), ladder('Science Fiction & Fantasy', 'Science Fiction')],
          series: [{ asin: 'TAGSERIES1', title: 'Tagged' }],
        },
        {
          asin: 'X000000032',
          language: 'english',
          category_ladders: [ladder('Science Fiction & Fantasy', 'Science Fiction', 'Military')],
          series: [{ asin: 'TAGSERIES1', title: 'Tagged' }],
        },
        {
          asin: 'X000000033',
          language: 'english',
          category_ladders: [ladder('Science Fiction & Fantasy', 'Science Fiction', 'Military')],
          series: [{ asin: 'TAGSERIES1', title: 'Tagged' }],
        },
      ],
    };

    const results = await search('tagged', 'us', page);

    expect(results[0].tags).toEqual(['Military', 'Epic', 'Science Fiction']);
  });
});
