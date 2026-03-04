/**
 * Component: Goodreads Shelf Sync Service
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * Fetches Goodreads shelf RSS feeds and delegates book processing
 * to the shared shelf-sync-core service.
 */

import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import {
  ShelfBook,
  ShelfSyncStats,
  ShelfSyncOptions,
  createEmptyStats,
  resolveMaxLookups,
  processShelfBooks,
} from '@/lib/services/shelf-sync-core.service';

const logger = RMABLogger.create('GoodreadsSync');

/**
 * Parse a Goodreads RSS feed XML into structured book data.
 */
function parseGoodreadsRss(xml: string): { shelfName: string; books: ShelfBook[] } {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
  });

  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel;
  if (!channel) {
    throw new Error('Invalid Goodreads RSS: no channel element');
  }

  const shelfName = typeof channel.title === 'string' ? channel.title : 'Goodreads Shelf';

  let items = channel.item;
  if (!items) return { shelfName, books: [] };
  if (!Array.isArray(items)) items = [items];

  const books: ShelfBook[] = [];
  for (const item of items) {
    const bookId = item.book_id?.toString();
    if (!bookId) continue;

    const title = (item.title || '').toString().trim();
    const author = (item.author_name || '').toString().trim();
    const coverUrl = (item.book_large_image_url || item.book_medium_image_url || item.book_image_url || '').toString().trim() || undefined;

    if (title && author) {
      books.push({ bookId, title, author, coverUrl });
    }
  }

  return { shelfName, books };
}

/** Max items Goodreads returns per RSS page */
const GOODREADS_PAGE_SIZE = 100;

/** Safety cap to avoid infinite loops */
const MAX_PAGES = 50;

/**
 * Fetch and validate a Goodreads RSS URL.
 * Automatically paginates (sort=title, page=1,2,...) when a page returns 100 items.
 * Deduplicates by bookId across pages.
 */
export async function fetchAndValidateRss(rssUrl: string): Promise<{ shelfName: string; books: ShelfBook[] }> {
  const url = new URL(rssUrl);
  url.searchParams.set('sort', 'title');

  let shelfName = 'Goodreads Shelf';
  const seenIds = new Set<string>();
  const allBooks: ShelfBook[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    url.searchParams.set('page', page.toString());

    const response = await axios.get(url.toString(), { timeout: 15000 });
    const parsed = parseGoodreadsRss(response.data);

    if (page === 1) {
      shelfName = parsed.shelfName;
    }

    for (const book of parsed.books) {
      if (!seenIds.has(book.bookId)) {
        seenIds.add(book.bookId);
        allBooks.push(book);
      }
    }

    if (parsed.books.length < GOODREADS_PAGE_SIZE) break;
  }

  return { shelfName, books: allBooks };
}

// Re-export types that downstream consumers expect
export type { ShelfSyncStats as GoodreadsSyncStats };
export type { ShelfSyncOptions as GoodreadsSyncOptions };

/**
 * Process Goodreads shelves: fetch RSS, resolve ASINs, create requests.
 * Called from the unified sync_reading_shelves processor.
 */
export async function processGoodreadsShelves(
  jobLogger?: ReturnType<typeof RMABLogger.forJob>,
  options: ShelfSyncOptions = {}
): Promise<ShelfSyncStats> {
  const log = jobLogger || logger;
  const stats = createEmptyStats();
  const maxLookups = resolveMaxLookups(options);

  const whereClause = options.shelfId ? { id: options.shelfId } : {};
  const shelves = await prisma.goodreadsShelf.findMany({
    where: whereClause,
    include: { user: { select: { id: true, plexUsername: true } } },
  });

  if (shelves.length === 0) {
    log.info(options.shelfId ? 'Shelf not found' : 'No Goodreads shelves configured, skipping');
    return stats;
  }

  log.info(`Processing ${shelves.length} Goodreads shelf(s)${maxLookups > 0 ? ` (max ${maxLookups} lookups/shelf)` : ' (unlimited lookups)'}`);

  for (const shelf of shelves) {
    try {
      log.info(`Fetching RSS for shelf "${shelf.name}" (user: ${shelf.user.plexUsername})`);

      let rssData: { shelfName: string; books: ShelfBook[] };
      try {
        rssData = await fetchAndValidateRss(shelf.rssUrl);
      } catch (error) {
        log.error(`Failed to fetch RSS for shelf "${shelf.name}": ${error instanceof Error ? error.message : 'Unknown error'}`);
        stats.errors++;
        continue;
      }

      log.info(`Found ${rssData.books.length} books in shelf "${shelf.name}"`);

      const bookData = await processShelfBooks(
        'goodreads', rssData.books, shelf.user.id, shelf.id, stats, log, maxLookups,
      );

      await prisma.goodreadsShelf.update({
        where: { id: shelf.id },
        data: {
          lastSyncAt: new Date(),
          bookCount: rssData.books.length,
          coverUrls: bookData.length > 0 ? JSON.stringify(bookData) : null,
        },
      });

      stats.shelvesProcessed++;
    } catch (error) {
      stats.errors++;
      log.error(`Failed to process shelf "${shelf.name}" for user ${shelf.user.plexUsername}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  log.info(`Goodreads sync complete: ${stats.shelvesProcessed} shelves, ${stats.booksFound} books, ${stats.lookupsPerformed} lookups, ${stats.requestsCreated} requests created, ${stats.errors} errors`);
  return stats;
}
