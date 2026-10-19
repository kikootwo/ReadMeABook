/**
 * Component: XML Entity Decoding Pins (Prowlarr RSS + Goodreads RSS)
 * Documentation: documentation/phase3/prowlarr.md
 *
 * Pins how fast-xml-parser decodes escaped entities and CDATA in the two RSS
 * feeds RMAB parses, so a parser upgrade that changes titles/authors fails here.
 * Both parsers set `htmlEntities: true` (fast-xml-parser 5.6+ stopped decoding
 * numeric references by default). That also decodes other numeric references
 * such as &#233;, which older versions left as-is, and a short list of named ones
 * (&nbsp;, dashes, curly quotes, &hellip;, currency); other HTML named entities such as
 * &eacute; are still left as-is.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosMock = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), isAxiosError: () => false }));

vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: async () => null, getMany: async () => ({}) }) }));
vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const torznab = (title: string, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>Indexer</title>
    <item>
      <title>${title}</title>
      <guid>https://indexer.example/details/1</guid>
      <link>https://prowlarr.example/1/download?link=a&amp;file=Book</link>
      <size>524288000</size>
      <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
      ${extra}
      <torznab:attr name="seeders" value="10" />
      <torznab:attr name="peers" value="12" />
    </item>
  </channel>
</rss>`;

describe('Prowlarr RSS entity decoding (getRssFeed)', () => {
  beforeEach(() => {
    axiosMock.create.mockReturnValue({ interceptors: { request: { use: vi.fn() } }, get: vi.fn() });
  });

  const titleOf = async (xmlTitle: string, extra = '') => {
    axiosMock.get.mockResolvedValueOnce({ data: torznab(xmlTitle, extra) });
    const { ProwlarrService } = await import('@/lib/integrations/prowlarr.service');
    const [result] = await new ProwlarrService('https://prowlarr.example', 'key').getRssFeed(1);
    return result;
  };

  it.each([
    ['&amp;', 'Tom &amp; Jerry - Author', 'Tom & Jerry - Author'],
    ['&#39;', 'The Hitchhiker&#39;s Guide', "The Hitchhiker's Guide"],
    ['&#x27;', 'The Hitchhiker&#x27;s Guide', "The Hitchhiker's Guide"],
    ['&#233; (decoded) and &eacute; (left as-is)', 'Caf&#233; &eacute;t&eacute;', 'Café &eacute;t&eacute;'],
    ['escaped <b>', '&lt;b&gt;Bold&lt;/b&gt; Title', '<b>Bold</b> Title'],
    ['CDATA with <b> and &amp;', '<![CDATA[<b>Bold</b> &amp; Title]]>', '<b>Bold</b> &amp; Title'],
  ])('decodes %s in a title', async (_label, xmlTitle, expected) => {
    expect((await titleOf(xmlTitle)).title).toBe(expected);
  });

  it('decodes &amp; in the download link', async () => {
    expect((await titleOf('Book')).downloadUrl).toBe('https://prowlarr.example/1/download?link=a&file=Book');
  });
});

const goodreads = (title: string, author: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Shelf &amp; Friends&#39; Picks</title>
    <item>
      <book_id>42</book_id>
      <title>${title}</title>
      <author_name>${author}</author_name>
      <book_large_image_url>https://i.gr-assets.com/x.jpg?a=1&amp;b=2</book_large_image_url>
    </item>
  </channel>
</rss>`;

describe('Goodreads RSS entity decoding (fetchAndValidateRss)', () => {
  const parse = async (title: string, author: string) => {
    axiosMock.get.mockResolvedValueOnce({ data: goodreads(title, author) });
    const { fetchAndValidateRss } = await import('@/lib/services/goodreads-sync.service');
    return fetchAndValidateRss('https://www.goodreads.com/review/list_rss/1?shelf=to-read');
  };

  it('decodes &amp; and &#39; in the shelf name', async () => {
    expect((await parse('Book', 'Author')).shelfName).toBe("Shelf & Friends' Picks");
  });

  it.each([
    ['&amp;', 'Pride &amp; Prejudice', 'Pride & Prejudice'],
    ['&#39;', 'Ender&#39;s Game', "Ender's Game"],
    ['&#x27;', 'Ender&#x27;s Game', "Ender's Game"],
    ['&#233; (decoded) and &eacute; (left as-is)', 'Les Mis&#233;rables &eacute;dition', 'Les Misérables &eacute;dition'],
    ['escaped <b>', '&lt;b&gt;Dune&lt;/b&gt;', '<b>Dune</b>'],
    ['CDATA with <b> and &amp;', '<![CDATA[<b>Dune</b> &amp; Sequel]]>', '<b>Dune</b> &amp; Sequel'],
  ])('decodes %s in a book title', async (_label, xmlTitle, expected) => {
    const { books } = await parse(xmlTitle, 'Frank O&#39;Brien &amp; Co');
    expect(books[0].title).toBe(expected);
    expect(books[0].author).toBe("Frank O'Brien & Co");
    expect(books[0].coverUrl).toBe('https://i.gr-assets.com/x.jpg?a=1&b=2');
  });
});
