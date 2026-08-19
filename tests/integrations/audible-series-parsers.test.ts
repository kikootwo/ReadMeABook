/**
 * Component: Audible Series Page Parser Tests
 * Documentation: documentation/integrations/audible.md
 *
 * Audible A/B-serves two series-page layouts. Fixtures below mirror the real
 * markup of each. The parity tests are the point: both layouts must yield the
 * same books, cover, rating and description.
 */

import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  parseSeriesBooks,
  parseSeriesDescription,
  parseSeriesPageSummary,
  parseSimilarSeries,
} from '@/lib/integrations/audible-series-parsers';
import { getLanguageForRegion } from '@/lib/constants/language-config';

const LANG = getLanguageForRegion('us');

const parseBooks = ($: cheerio.CheerioAPI) =>
  parseSeriesBooks($, LANG.scraping.authorPrefixes, LANG.scraping.narratorPrefixes, LANG);

// ---------------------------------------------------------------------------
// Fixture data — one single-narrator and one multi-narrator title
// ---------------------------------------------------------------------------

interface FixtureBook {
  asin: string;
  title: string;
  narrators: string[];
  duration: string;
  minutes: number;
  rating: number;
  releaseDate: string;
}

const AUTHOR = 'J.T. Wright';
const AUTHOR_ASIN = 'B085Q425VB';
const DESCRIPTION = 'The Infinite World: ever-changing and ever growing.';
const TAGS = ['Epic Fantasy', 'Feel-Good'];
const COVER_SRC = 'https://m.media-amazon.com/images/I/51mVFLRVLTL._SL175_.jpg';
const COVER_EXPECTED = 'https://m.media-amazon.com/images/I/51mVFLRVLTL._SL500_.jpg';

const BOOKS: FixtureBook[] = [
  {
    asin: '177424599X',
    title: 'The Land of the Undying Lord',
    narrators: ['Tim Campbell'],
    duration: '16 hrs and 17 mins',
    minutes: 977,
    rating: 4.8,
    releaseDate: '2020-10-20',
  },
  {
    asin: 'B09VW5NBLS',
    title: 'Brambles and Thorns',
    narrators: ['Tim Campbell', 'Andrea Parsneau'],
    duration: '19 hrs and 31 mins',
    minutes: 1171,
    rating: 4.7,
    releaseDate: '2022-04-12',
  },
];

/** "Listeners also enjoyed" carousel — present in BOTH layouts. */
function similarSeriesCarousel(): string {
  return `
    <adbl-product-carousel id="SeriestoSeries">
      <adbl-product-grid-item>
        <div class="adbl-impression-emitted" data-asin="B0CGS1LPWJ"></div>
        <adbl-collection-image><img src="https://m.media-amazon.com/images/I/other._SL175_.jpg" /></adbl-collection-image>
        <adbl-metadata slot="title"><a href="/series/Hockey-Guys/B0CGS1LPWJ">Hockey Guys</a></adbl-metadata>
        <adbl-metadata slot="child-count">3 titles</adbl-metadata>
      </adbl-product-grid-item>
    </adbl-product-carousel>`;
}

// ---------------------------------------------------------------------------
// Modern layout fixture (<adbl-product-row> + embedded JSON)
// ---------------------------------------------------------------------------

function modernRow(book: FixtureBook, index: number, metadataJson?: string): string {
  const json = metadataJson ?? JSON.stringify({
    authors: [{ name: AUTHOR, url: `/author/JT-Wright/${AUTHOR_ASIN}` }],
    narrators: book.narrators.map(n => ({ name: n, url: `/search?searchNarrator=${encodeURIComponent(n)}` })),
    duration: book.duration,
    language: 'English',
    releaseDate: book.releaseDate,
    rating: { value: book.rating, count: 4831 },
  });

  return `
    <adbl-style-scope>
      <adbl-product-row variant="catalog" series-header="Book ${index + 1}" placement="base">
        <a href="/pd/slug-audiobook/${book.asin}" slot="image">
          <adbl-product-image><img src="${COVER_SRC}" alt="${book.title}" loading="lazy" /></adbl-product-image>
        </a>
        <h3 slot="title"><a href="/pd/slug-audiobook/${book.asin}">${book.title}</a></h3>
        <h4 slot="subtitle">The Infinite World, Book ${index + 1}</h4>
        <adbl-sample-button slot="sample-button" data-asin="${book.asin}"></adbl-sample-button>
        <script type="application/json">${json}</script>
      </adbl-product-row>
    </adbl-style-scope>`;
}

function makeModernPage(rows: string = BOOKS.map((b, i) => modernRow(b, i)).join('')): string {
  return `<html><body>
    <adbl-metadata-group size="xl">
      <adbl-metadata slot="title"><h1>The Infinite World</h1></adbl-metadata>
      <span slot="child"> ${BOOKS.length} books in series </span>
      <adbl-star-rating slot="rating" value="5" count="13156" aria-label="13,156 ratings">
        <noscript>13,156 ratings</noscript>
      </adbl-star-rating>
    </adbl-metadata-group>
    <div id="series-about">
      <adbl-text-block lines="2">
        <h3 slot="title">The Land of the Undying Lord Publisher's summary</h3>
        <p>${DESCRIPTION}</p>
      </adbl-text-block>
      <adbl-chip-group>
        ${TAGS.map(t => `<adbl-chip href="/tag/theme/x" class="adbl_rec_tag related-tag">${t}</adbl-chip>`).join('')}
      </adbl-chip-group>
    </div>
    <div id="series-titles">${rows}</div>
    ${similarSeriesCarousel()}
  </body></html>`;
}

// ---------------------------------------------------------------------------
// Legacy layout fixture (<li class="productListItem">)
// ---------------------------------------------------------------------------

function legacyItem(book: FixtureBook): string {
  const narratorLinks = book.narrators
    .map(n => `<a href="/search?searchNarrator=${encodeURIComponent(n)}">${n}</a>`)
    .join(', ');

  return `
    <li class="bc-list-item productListItem" data-asin="${book.asin}">
      <div class="bc-container">
        <img src="${COVER_SRC}" />
        <h3 class="bc-heading"><a href="/pd/slug-audiobook/${book.asin}">${book.title}</a></h3>
        <ul class="bc-list">
          <li class="bc-list-item authorLabel"><a href="/author/JT-Wright/${AUTHOR_ASIN}">${AUTHOR}</a></li>
          <li class="bc-list-item narratorLabel">Narrated by: ${narratorLinks}</li>
          <li class="bc-list-item runtimeLabel">Length: ${book.duration}</li>
        </ul>
        <span class="ratingsLabel">${book.rating} out of 5</span>
      </div>
    </li>`;
}

function makeLegacyPage(items: string = BOOKS.map(legacyItem).join('')): string {
  return `<html><body>
    <h1>The Infinite World</h1>
    <span class="bc-text">${BOOKS.length} books</span>
    <div class="bc-review-stars" aria-label="5 out of 5 stars"></div>
    <span class="series-rating bc-color-secondary">13,156 ratings</span>
    <div class="bc-expander-content">${DESCRIPTION}</div>
    ${TAGS.map(t => `<adbl-chip href="/tag/theme/x" class="adbl_rec_tag related-tag">${t}</adbl-chip>`).join('')}
    <ul class="bc-list">${items}</ul>
    ${similarSeriesCarousel()}
  </body></html>`;
}

const modern$ = () => cheerio.load(makeModernPage());
const legacy$ = () => cheerio.load(makeLegacyPage());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseSeriesBooks', () => {
  it('parses books from the modern adbl-product-row layout', () => {
    const books = parseBooks(modern$());

    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({
      asin: '177424599X',
      title: 'The Land of the Undying Lord',
      author: AUTHOR,
      authorAsin: AUTHOR_ASIN,
      narrator: 'Tim Campbell',
      coverArtUrl: COVER_EXPECTED,
      rating: 4.8,
      durationMinutes: 977,
      releaseDate: '2020-10-20',
      language: 'English',
    });
  });

  it('parses books from the legacy productListItem layout', () => {
    const books = parseBooks(legacy$());

    expect(books).toHaveLength(2);
    expect(books[0]).toMatchObject({
      asin: '177424599X',
      title: 'The Land of the Undying Lord',
      author: AUTHOR,
      authorAsin: AUTHOR_ASIN,
      narrator: 'Tim Campbell',
      coverArtUrl: COVER_EXPECTED,
      rating: 4.8,
      durationMinutes: 977,
    });
  });

  it('yields identical core book data for both layouts', () => {
    const core = (b: Record<string, unknown>) => ({
      asin: b.asin,
      title: b.title,
      author: b.author,
      authorAsin: b.authorAsin,
      narrator: b.narrator,
      coverArtUrl: b.coverArtUrl,
      rating: b.rating,
      durationMinutes: b.durationMinutes,
    });

    expect(parseBooks(modern$()).map(core)).toEqual(parseBooks(legacy$()).map(core));
  });

  it('captures every narrator of a multi-narrator production in both layouts', () => {
    expect(parseBooks(modern$())[1].narrator).toBe('Tim Campbell, Andrea Parsneau');
    expect(parseBooks(legacy$())[1].narrator).toBe('Tim Campbell, Andrea Parsneau');
  });

  it('still returns title, asin and cover when a row JSON blob is malformed', () => {
    const $ = cheerio.load(makeModernPage(modernRow(BOOKS[0], 0, '{not valid json')));
    const books = parseBooks($);

    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      asin: '177424599X',
      title: 'The Land of the Undying Lord',
      coverArtUrl: COVER_EXPECTED,
    });
    expect(books[0].durationMinutes).toBeUndefined();
    expect(books[0].narrator).toBeUndefined();
  });

  it('ignores product rows inside a similar-series carousel', () => {
    const $ = cheerio.load(`<html><body>
      <adbl-product-carousel id="SeriestoSeries">${modernRow(BOOKS[0], 0)}</adbl-product-carousel>
    </body></html>`);

    expect(parseBooks($)).toEqual([]);
  });

  it('returns an empty array when the page has no book rows', () => {
    expect(parseBooks(cheerio.load('<html><body><h1>The Infinite World</h1></body></html>'))).toEqual([]);
  });
});

describe('parseSeriesPageSummary', () => {
  it('parses header fields from the modern layout', () => {
    expect(parseSeriesPageSummary(modern$(), 'B08L6182J8')).toEqual({
      asin: 'B08L6182J8',
      title: 'The Infinite World',
      bookCount: 2,
      rating: 5,
      ratingCount: 13156,
      tags: TAGS,
      coverArtUrl: COVER_EXPECTED,
    });
  });

  it('parses header fields from the legacy layout', () => {
    expect(parseSeriesPageSummary(legacy$(), 'B08L6182J8')).toEqual({
      asin: 'B08L6182J8',
      title: 'The Infinite World',
      bookCount: 2,
      rating: 5,
      ratingCount: 13156,
      tags: TAGS,
      coverArtUrl: COVER_EXPECTED,
    });
  });

  it('never takes the book count from the similar-series carousel', () => {
    // The carousel advertises "3 titles" for a different series.
    expect(parseSeriesPageSummary(modern$(), 'B08L6182J8').bookCount).toBe(2);
    expect(parseSeriesPageSummary(legacy$(), 'B08L6182J8').bookCount).toBe(2);
  });

  it('falls back to counting rendered rows when no header count exists', () => {
    const $ = cheerio.load(`<html><body>
      <h1>The Infinite World</h1>
      <div id="series-titles">${BOOKS.map((b, i) => modernRow(b, i)).join('')}</div>
    </body></html>`);

    expect(parseSeriesPageSummary($, 'B08L6182J8').bookCount).toBe(2);
  });
});

describe('parseSeriesDescription', () => {
  it('reads the description from the modern adbl-text-block', () => {
    expect(parseSeriesDescription(modern$())).toBe(DESCRIPTION);
  });

  it('reads the description from the legacy expander content', () => {
    expect(parseSeriesDescription(legacy$())).toBe(DESCRIPTION);
  });

  it('returns undefined when no description is present', () => {
    expect(parseSeriesDescription(cheerio.load('<html><body><h1>x</h1></body></html>'))).toBeUndefined();
  });
});

describe('parseSimilarSeries', () => {
  it('parses the SeriestoSeries carousel in both layouts', () => {
    const expected = [{
      asin: 'B0CGS1LPWJ',
      title: 'Hockey Guys',
      bookCount: 3,
      coverArtUrl: 'https://m.media-amazon.com/images/I/other._SL500_.jpg',
    }];

    expect(parseSimilarSeries(modern$())).toEqual(expected);
    expect(parseSimilarSeries(legacy$())).toEqual(expected);
  });
});
