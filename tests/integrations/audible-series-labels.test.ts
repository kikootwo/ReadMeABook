/**
 * Component: Audible Series Page Position Label Tests (#599)
 * Documentation: documentation/integrations/audible.md
 *
 * Each series page row carries its position: the modern `series-header` attribute
 * ("1. Titel" on audible.de, "Book N", "Vol. N"), the legacy h2 label. Offline fixtures.
 */

import * as cheerio from 'cheerio';
import { describe, expect, it, vi } from 'vitest';
import { parseSeriesBooks } from '@/lib/integrations/audible-series-parsers';
import { getLanguageForRegion } from '@/lib/constants/language-config';
import { deduplicateAndCollectGroups } from '@/lib/utils/deduplicate-audiobooks';

const DE = getLanguageForRegion('de');
const SERIES = 'B0H3C5X19W';

const fakeAudible = vi.hoisted(() => ({
  getRegion: vi.fn(() => 'de'),
  getBaseUrl: vi.fn(() => 'https://www.audible.de'),
  fetch: vi.fn(),
}));
vi.mock('@/lib/integrations/audible.service', () => ({ getAudibleService: () => fakeAudible }));
vi.mock('@/lib/services/config.service', () => ({
  getConfigService: () => ({ getAudibleLanguageFilter: async () => false }),
}));

const parse = (html: string) =>
  parseSeriesBooks(cheerio.load(html), DE.scraping.authorPrefixes, DE.scraping.narratorPrefixes, DE);

function modernRow(asin: string, title: string, label: string | null): string {
  const json = JSON.stringify({ authors: [{ name: 'Author' }], narrators: [{ name: 'Narrator One' }], duration: '8 Std. 20 Min.' });
  return `<adbl-product-row variant="catalog" ${label === null ? '' : `series-header="${label}"`}>
      <a href="/pd/slug/${asin}" slot="image"><adbl-product-image><img src="x.jpg" /></adbl-product-image></a>
      <h3 slot="title"><a href="/pd/slug/${asin}">${title}</a></h3>
      <script type="application/json">${json}</script>
    </adbl-product-row>`;
}

const modernPage = (rows: string) => `<html><body><h1>Series</h1><div id="series-titles">${rows}</div></body></html>`;

function legacyItem(asin: string, inner: string): string {
  return `<li class="bc-list-item productListItem" data-asin="${asin}">${inner}
      <ul class="bc-list"><li class="bc-list-item authorLabel"><a href="/author/x/B000000001">Author</a></li></ul>
    </li>`;
}

const legacyPage = (items: string) => `<html><body><h1>Series</h1><ul class="bc-list">${items}</ul></body></html>`;

describe('series page position labels', () => {
  it('reads the modern series-header label as a normalized position', () => {
    const books = parse(modernPage(
      modernRow('B0H36S85HC', 'Die Tagebücher der Apothekerin 1', '1. Titel') +
      modernRow('B0H6N477LX', 'Book One and a Half', 'Book 1.5') +
      modernRow('B0H6N6TH8T', 'Third', 'Vol. 3') +
      modernRow('B0HQZV8WC6', 'Unlabelled', null),
    ));
    expect(books.map((b) => b.seriesPart)).toEqual(['1', '1.5', '3', undefined]);
  });

  it('reads a legacy h2 label when the title came from the h3', () => {
    const books = parse(legacyPage(
      legacyItem('B0H36S85HC', '<h2 class="bc-text">Book 2</h2><h3 class="bc-heading"><a href="/pd/x/B0H36S85HC">Title Two</a></h3>') +
      legacyItem('B0H6N477LX', '<h3 class="bc-heading"><a href="/pd/x/B0H6N477LX">No Label</a></h3>'),
    ));
    expect(books[0]).toMatchObject({ title: 'Title Two', seriesPart: '2' });
    expect(books[1].seriesPart).toBeUndefined();
  });

  it('takes no position from an h2 that holds the title', () => {
    const books = parse(legacyPage(legacyItem('B07KEEP013', '<h2><a href="/pd/x/B07KEEP013">Keeping 13 - Mettiti in gioco</a></h2>')));
    expect(books[0]).toMatchObject({ title: 'Keeping 13 - Mettiti in gioco' });
    expect(books[0].seriesPart).toBeUndefined();
  });

  it('takes no position from an h2 whose own .bc-heading link holds a numeric title', () => {
    const books = parse(legacyPage(legacyItem('B0NUMERIC1', '<h2 class="bc-heading"><a href="/pd/x/B0NUMERIC1">1984</a></h2>')));
    expect(books[0]).toMatchObject({ title: '1984' });
    expect(books[0].seriesPart).toBeUndefined();
  });

  it('takes no position from a non-label h2 next to an h3 title', () => {
    const books = parse(legacyPage(legacyItem('B0H36S85HC', '<h2>Keeping 13</h2><h3 class="bc-heading"><a href="/pd/x/B0H36S85HC">Title</a></h3>')));
    expect(books[0].seriesPart).toBeUndefined();
  });

  it('scrapeSeriesPage stamps the series ASIN; a re-listing pair sharing one label stays merged and persistable', async () => {
    fakeAudible.fetch.mockResolvedValue({
      data: {
        data: modernPage(
          modernRow('B0H36S85HC', 'Die Tagebücher der Apothekerin', '1. Titel') +
          modernRow('B0RELIST01', 'Die Tagebücher der Apothekerin', '1. Titel') +
          modernRow('B0H6N477LX', 'Die Tagebücher der Apothekerin', '2. Titel'),
        ),
      },
    });
    const { scrapeSeriesPage } = await import('@/lib/integrations/audible-series');

    const detail = await scrapeSeriesPage(SERIES);

    expect(detail?.books.every((b) => b.seriesAsin === SERIES)).toBe(true);
    const { books, groups } = deduplicateAndCollectGroups(detail!.books);
    expect(books.map((b) => b.asin)).toEqual(['B0H36S85HC', 'B0H6N477LX']);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ allAsins: ['B0H36S85HC', 'B0RELIST01'], persistable: true });
  });
});
