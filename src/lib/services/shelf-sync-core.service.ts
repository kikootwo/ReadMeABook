/**
 * Component: Shelf Sync Core Service
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * Shared logic for all shelf providers: Audible lookup, noMatch retry,
 * request creation, cover enrichment, and shelf metadata updates.
 * Provider-specific services (Goodreads, Hardcover) call into this core.
 */

import { prisma } from '@/lib/db';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { createRequestForUser } from '@/lib/services/request-creator.service';
import { RMABLogger } from '@/lib/utils/logger';
import { BookMapping } from '@/generated/prisma';

/** Default max Audible lookups per shelf per scheduled sync cycle */
const DEFAULT_MAX_LOOKUPS_PER_SHELF = 10;

/** Days before retrying a noMatch book */
const NO_MATCH_RETRY_DAYS = 7;

/** Provider-agnostic book from any shelf source */
export interface ShelfBook {
  bookId: string;
  title: string;
  author: string;
  coverUrl?: string;
}

/** Sync stats shared across all providers */
export interface ShelfSyncStats {
  shelvesProcessed: number;
  booksFound: number;
  lookupsPerformed: number;
  requestsCreated: number;
  errors: number;
}

/** Common sync options */
export interface ShelfSyncOptions {
  shelfId?: string;
  maxLookupsPerShelf?: number;
}

type LoggerType = ReturnType<typeof RMABLogger.forJob> | ReturnType<typeof RMABLogger.create>;

export function createEmptyStats(): ShelfSyncStats {
  return { shelvesProcessed: 0, booksFound: 0, lookupsPerformed: 0, requestsCreated: 0, errors: 0 };
}

export function mergeStats(target: ShelfSyncStats, source: ShelfSyncStats): void {
  target.shelvesProcessed += source.shelvesProcessed;
  target.booksFound += source.booksFound;
  target.lookupsPerformed += source.lookupsPerformed;
  target.requestsCreated += source.requestsCreated;
  target.errors += source.errors;
}

export function resolveMaxLookups(options: ShelfSyncOptions): number {
  return options.maxLookupsPerShelf ?? DEFAULT_MAX_LOOKUPS_PER_SHELF;
}

/**
 * Process a list of books from any provider: resolve to ASINs, create requests,
 * enrich covers, and return book data for shelf metadata.
 */
export async function processShelfBooks(
  provider: string,
  books: ShelfBook[],
  userId: string,
  shelfId: string,
  stats: ShelfSyncStats,
  log: LoggerType,
  maxLookups: number,
): Promise<{ coverUrl: string; asin: string | null; title: string; author: string }[]> {
  stats.booksFound += books.length;

  let lookupsThisCycle = 0;
  const unlimitedLookups = maxLookups === 0;

  for (const book of books) {
    let mapping = await prisma.bookMapping.findUnique({
      where: { provider_externalBookId: { provider, externalBookId: book.bookId } },
    });

    if (!mapping) {
      if (!unlimitedLookups && lookupsThisCycle >= maxLookups) continue;

      mapping = await performAudibleLookup(provider, book, log);
      lookupsThisCycle++;
      stats.lookupsPerformed++;

      if (!mapping?.audibleAsin) continue;
    }

    if (mapping.noMatch) {
      if (mapping.lastSearchAt) {
        const daysSinceSearch = (Date.now() - mapping.lastSearchAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceSearch >= NO_MATCH_RETRY_DAYS && (unlimitedLookups || lookupsThisCycle < maxLookups)) {
          log.info(`Retrying Audible lookup for "${book.title}" (${NO_MATCH_RETRY_DAYS}+ days since last search)`);
          mapping = await performAudibleLookup(provider, book, log, mapping.id);
          lookupsThisCycle++;
          stats.lookupsPerformed++;

          if (!mapping?.audibleAsin) continue;
        } else {
          continue;
        }
      } else {
        continue;
      }
    }

    if (mapping.audibleAsin) {
      try {
        const result = await createRequestForUser(userId, {
          asin: mapping.audibleAsin,
          title: mapping.title,
          author: mapping.author,
          coverArtUrl: mapping.coverUrl || undefined,
        });

        if (result.success) {
          stats.requestsCreated++;
          log.info(`Created request for "${mapping.title}" by ${mapping.author} (ASIN: ${mapping.audibleAsin})`);
        }
      } catch (error) {
        log.error(`Failed to create request for "${mapping.title}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  return enrichBookCovers(provider, books);
}

/**
 * Enrich book list with cached cover URLs from AudibleCache.
 * Returns up to 8 books with the best available cover URL.
 */
async function enrichBookCovers(
  provider: string,
  books: ShelfBook[],
): Promise<{ coverUrl: string; asin: string | null; title: string; author: string }[]> {
  const bookIds = books.map(b => b.bookId);
  const mappings = bookIds.length > 0
    ? await prisma.bookMapping.findMany({
        where: { provider, externalBookId: { in: bookIds } },
        select: { externalBookId: true, audibleAsin: true, title: true, author: true, coverUrl: true },
      })
    : [];
  const mappingsByBookId = new Map(mappings.map(m => [m.externalBookId, m]));

  const matchedAsins = mappings
    .map(m => m.audibleAsin)
    .filter((asin): asin is string => !!asin);
  const cachedCovers = matchedAsins.length > 0
    ? await prisma.audibleCache.findMany({
        where: { asin: { in: matchedAsins } },
        select: { asin: true, coverArtUrl: true, cachedCoverPath: true },
      })
    : [];
  const coverByAsin = new Map(
    cachedCovers
      .filter(c => c.cachedCoverPath || c.coverArtUrl)
      .map(c => {
        let coverUrl = c.coverArtUrl || '';
        if (c.cachedCoverPath) {
          const filename = c.cachedCoverPath.split('/').pop();
          coverUrl = `/api/cache/thumbnails/${filename}`;
        }
        return [c.asin, coverUrl] as const;
      })
  );

  return books
    .map(b => {
      const mapping = mappingsByBookId.get(b.bookId);
      const coverUrl = coverByAsin.get(mapping?.audibleAsin || '') || mapping?.coverUrl || b.coverUrl;
      if (!coverUrl) return null;
      return {
        coverUrl,
        asin: mapping?.audibleAsin || null,
        title: mapping?.title || b.title,
        author: mapping?.author || b.author,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .slice(0, 8);
}

/**
 * Search Audible for a book, persist the result to the unified BookMapping table.
 */
async function performAudibleLookup(
  provider: string,
  book: ShelfBook,
  log: LoggerType,
  existingMappingId?: string,
): Promise<BookMapping | null> {
  const audibleService = getAudibleService();

  try {
    const fullQuery = `${book.title} ${book.author}`;
    log.info(`Searching Audible for: "${fullQuery}"`);

    let searchResult = await audibleService.search(fullQuery);
    let firstResult = searchResult.results[0];

    if (!firstResult?.asin) {
      const cleanTitle = book.title.replace(/\s*\(.*\)\s*$/, '').trim();
      if (cleanTitle !== book.title) {
        const cleanQuery = `${cleanTitle} ${book.author}`;
        log.info(`No results with full title, retrying without series info: "${cleanQuery}"`);
        searchResult = await audibleService.search(cleanQuery);
        firstResult = searchResult.results[0];
      }
    }

    if (firstResult?.asin) {
      log.info(`Audible match: "${book.title}" → ASIN ${firstResult.asin} ("${firstResult.title}" by ${firstResult.author})`);

      const data = {
        title: firstResult.title,
        author: firstResult.author,
        audibleAsin: firstResult.asin,
        coverUrl: firstResult.coverArtUrl || book.coverUrl || null,
        noMatch: false,
        lastSearchAt: new Date(),
      };

      if (existingMappingId) {
        return prisma.bookMapping.update({ where: { id: existingMappingId }, data });
      }
      return prisma.bookMapping.create({
        data: { provider, externalBookId: book.bookId, ...data },
      });
    }

    log.info(`No Audible match for "${book.title}" by ${book.author}`);

    const noMatchData = {
      title: book.title,
      author: book.author,
      coverUrl: book.coverUrl || null,
      noMatch: true,
      lastSearchAt: new Date(),
      audibleAsin: null,
    };

    if (existingMappingId) {
      return prisma.bookMapping.update({ where: { id: existingMappingId }, data: noMatchData });
    }
    return prisma.bookMapping.create({
      data: { provider, externalBookId: book.bookId, ...noMatchData },
    });
  } catch (error) {
    log.error(`Audible lookup failed for "${book.title}": ${error instanceof Error ? error.message : 'Unknown error'}`);

    const errorData = {
      title: book.title,
      author: book.author,
      coverUrl: book.coverUrl || null,
      noMatch: true,
      lastSearchAt: new Date(),
    };

    if (existingMappingId) {
      return prisma.bookMapping.update({ where: { id: existingMappingId }, data: errorData });
    }
    return prisma.bookMapping.create({
      data: { provider, externalBookId: book.bookId, ...errorData },
    });
  }
}
