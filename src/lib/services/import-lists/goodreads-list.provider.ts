/**
 * Component: Goodreads List (Listopia) Provider
 * Documentation: documentation/backend/services/list-sync.md
 *
 * Reads a public Goodreads Listopia list (https://www.goodreads.com/list/show/{id}) by
 * scraping the paginated HTML page (100 books per page, ranked). No account or feed is
 * needed. Only www.goodreads.com is ever contacted.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

const GOODREADS_HOST = 'www.goodreads.com';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const PAGE_DELAY_MS = 2500;
const TIMEOUT_MS = 20000;

export interface ListBook {
  /** Goodreads book id */
  bookId: string;
  title: string;
  author: string;
  coverUrl?: string;
  /** 1-based position on the list */
  rank: number;
}

export interface ListPage {
  name?: string;
  size?: number;
  books: ListBook[];
}

function listUrl(listId: number, page = 1): string {
  const base = `https://${GOODREADS_HOST}/list/show/${listId}`;
  return page > 1 ? `${base}?page=${page}` : base;
}

async function getPage(url: string): Promise<string> {
  const res = await axios.get<string>(url, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
    maxRedirects: 5,
    responseType: 'text',
    // Goodreads redirects /list/show/{id} to a slugged URL; never leave its host
    beforeRedirect: (options) => {
      if (options.hostname !== GOODREADS_HOST) {
        throw new Error('Refusing to follow a redirect away from Goodreads');
      }
    },
  });
  return res.data;
}

/** Drop a trailing "(Series Name, #1)" from a Goodreads title. */
export function cleanListTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

/** Parse one Listopia page. `startRank` is the rank of the first row on the page. */
export function parseListPage(html: string, startRank = 1): ListPage {
  const $ = cheerio.load(html);
  const heading = $('title').first().text();
  const meta = heading.match(/^(.*?)\s*\(([\d,]+)\s+books\)/);

  const books: ListBook[] = [];
  $('tr[itemtype="http://schema.org/Book"]').each((index, row) => {
    const link = $(row).find('a.bookTitle').first();
    const id = (link.attr('href') || '').match(/\/book\/show\/(\d+)/)?.[1];
    const title = cleanListTitle(link.find('span[itemprop="name"]').first().text() || link.text());
    const author = $(row).find('a.authorName span[itemprop="name"]').first().text().replace(/\s+/g, ' ').trim();
    if (!id || !title || !author) return;
    books.push({
      bookId: id,
      title,
      author,
      coverUrl: $(row).find('img.bookCover').first().attr('src') || undefined,
      rank: startRank + index,
    });
  });

  return {
    name: meta?.[1]?.trim(),
    size: meta ? parseInt(meta[2].replace(/,/g, ''), 10) : undefined,
    books,
  };
}

/** Read just the list's name and size (page 1). Throws if it is not a Goodreads list page. */
export async function readListMeta(listId: number): Promise<{ name: string; size: number }> {
  const page = parseListPage(await getPage(listUrl(listId)));
  if (!page.name || page.size === undefined) {
    throw new Error(`Goodreads list ${listId} was not found or could not be read`);
  }
  return { name: page.name, size: page.size };
}

/** Read the top `topN` books of a list (one request per 100 books, with a polite delay). */
export async function fetchListBooks(
  listId: number,
  topN: number,
): Promise<{ name?: string; size?: number; books: ListBook[] }> {
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(topN / PAGE_SIZE)));
  const books: ListBook[] = [];
  let name: string | undefined;
  let size: number | undefined;

  for (let page = 1; page <= pages; page++) {
    const parsed = parseListPage(await getPage(listUrl(listId, page)), books.length + 1);
    if (page === 1) {
      name = parsed.name;
      size = parsed.size;
    }
    if (parsed.books.length === 0) break;
    books.push(...parsed.books);
    if (books.length >= topN || parsed.books.length < PAGE_SIZE) break;
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
  }

  return { name, size, books: books.slice(0, topN) };
}
