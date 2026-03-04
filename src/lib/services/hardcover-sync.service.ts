/**
 * Component: Hardcover Shelf Sync Service
 * Documentation: documentation/backend/services/hardcover-sync.md
 *
 * Fetches Hardcover books using their GraphQL API, resolves books to Audible ASINs,
 * and creates requests via the shared request-creator service.
 */

import axios from 'axios';
import { prisma } from '@/lib/db';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { createRequestForUser } from '@/lib/services/request-creator.service';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('HardcoverSync');

/** Default max Audible lookups per shelf per scheduled sync cycle */
const DEFAULT_MAX_LOOKUPS_PER_SHELF = 10;

/** Days before retrying a noMatch book */
const NO_MATCH_RETRY_DAYS = 7;

const HARDCOVER_API_URL = 'https://api.hardcover.app/v1/graphql';

interface HardcoverApiBook {
  bookId: string;
  title: string;
  author: string;
  coverUrl?: string;
}

/**
 * Fetch a Hardcover List using their GraphQL API.
 * This handles both 'status_id' user_books or 'list_id' list_books queries.
 * For simplicity, we assume `listId` provided by the user is an Int corresponding to a list_id or status_id.
 */
export async function fetchHardcoverList(
  apiToken: string,
  listIdStr: string,
): Promise<{ listName: string; books: HardcoverApiBook[] }> {
  // Check if it's a status list
  const isStatus = listIdStr.startsWith('status-');

  if (isStatus) {
    const statusId = parseInt(listIdStr.replace('status-', ''), 10);
    const query = `
      query GetStatusBooks($statusId: Int!) {
        me {
          user_books(where: {status_id: {_eq: $statusId}}, limit: 100, order_by: {id: desc}) {
            book {
              id
              title
              contributions {
                author {
                  name
                }
              }
              cached_image
              image {
                url
              }
            }
          }
        }
      }
    `;

    const response = await axios.post(
      HARDCOVER_API_URL,
      { query, variables: { statusId } },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    if (response.data?.errors) {
      throw new Error(
        `Hardcover API Error: ${response.data.errors[0]?.message}`,
      );
    }

    const userBooks = response.data?.data?.me?.[0]?.user_books || [];
    let listName = 'Hardcover Status List';

    // Map status numbers to names
    const statusNames: Record<number, string> = {
      1: 'Want to Read',
      2: 'Currently Reading',
      3: 'Read',
      4: 'Did Not Finish',
    };
    listName = statusNames[statusId] || `Status ${statusId}`;

    const books: HardcoverApiBook[] = [];
    for (const item of userBooks) {
      const book = item.book;
      if (!book || !book.id) continue;

      const authorName =
        book.contributions?.[0]?.author?.name || 'Unknown Author';
      const coverUrl = book.cached_image || book.image?.url || undefined;

      books.push({
        bookId: book.id.toString(),
        title: book.title || 'Unknown Title',
        author: authorName,
        coverUrl,
      });
    }

    return { listName, books };
  } else {
    // Original list_books logic
    let isUuid = false;
    let isIntId = false;
    let extractedSlug = listIdStr;

    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        listIdStr,
      )
    ) {
      isUuid = true;
    } else if (/^\d+$/.test(listIdStr)) {
      isIntId = true;
    } else {
      try {
        if (listIdStr.includes('hardcover.app')) {
          const url = new URL(
            listIdStr.startsWith('http') ? listIdStr : `https://${listIdStr}`,
          );
          const parts = url.pathname.split('/').filter(Boolean);
          if (parts.length > 0) {
            extractedSlug = parts[parts.length - 1];
          }
        }
      } catch (e) {
        // use extractedSlug as-is
      }
    }

    const query = `
      query GetListBooks($listId: Int!) {
        list_books(where: {list_id: {_eq: $listId}}, limit: 100, order_by: {id: desc}) {
          list { name }
          book {
            id title cached_image image { url }
            contributions { author { name } }
          }
        }
      }
    `;

    const queryUuid = `
      query GetListBooksUuid($listId: uuid!) {
        list_books(where: {list_id: {_eq: $listId}}, limit: 100, order_by: {id: desc}) {
          list { name }
          book {
            id title cached_image image { url }
            contributions { author { name } }
          }
        }
      }
    `;

    const querySlug = `
      query GetListBooksBySlug($slug: String!) {
        lists(where: {slug: {_eq: $slug}}, limit: 1) {
          name
          list_books(limit: 100, order_by: {id: desc}) {
            book {
              id title cached_image image { url }
              contributions { author { name } }
            }
          }
        }
      }
    `;

    const isSlug = !isUuid && !isIntId;
    const activeQuery = isSlug ? querySlug : isUuid ? queryUuid : query;
    const variables = isSlug
      ? { slug: extractedSlug }
      : { listId: isUuid ? listIdStr : parseInt(listIdStr, 10) };

    const response = await axios.post(
      HARDCOVER_API_URL,
      {
        query: activeQuery,
        variables,
      },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    if (response.data?.errors) {
      throw new Error(
        `Hardcover API Error: ${response.data.errors[0]?.message}`,
      );
    }

    let listName = 'Hardcover List';
    let listBooks: any[] = [];

    if (isSlug) {
      const listsData = response.data?.data?.lists || [];
      if (listsData.length === 0) {
        throw new Error(`Could not find a list with slug "${extractedSlug}"`);
      }
      listName = listsData[0].name || listName;
      listBooks = listsData[0].list_books || [];
    } else {
      listBooks = response.data?.data?.list_books || [];
      if (listBooks.length > 0 && listBooks[0].list?.name) {
        listName = listBooks[0].list.name;
      }
    }

    const books: HardcoverApiBook[] = [];
    for (const item of listBooks) {
      const book = item.book;
      if (!book || !book.id) continue;

      const authorName =
        book.contributions?.[0]?.author?.name || 'Unknown Author';
      const coverUrl = book.cached_image || book.image?.url || undefined;

      books.push({
        bookId: book.id.toString(),
        title: book.title || 'Unknown Title',
        author: authorName,
        coverUrl,
      });
    }

    return { listName, books };
  }
}

export interface HardcoverSyncStats {
  shelvesProcessed: number;
  booksFound: number;
  lookupsPerformed: number;
  requestsCreated: number;
  errors: number;
}

export interface HardcoverSyncOptions {
  shelfId?: string;
  maxLookupsPerShelf?: number;
}

export async function processHardcoverShelves(
  jobLogger?: ReturnType<typeof RMABLogger.forJob>,
  options: HardcoverSyncOptions = {},
): Promise<HardcoverSyncStats> {
  const log = jobLogger || logger;
  const stats: HardcoverSyncStats = {
    shelvesProcessed: 0,
    booksFound: 0,
    lookupsPerformed: 0,
    requestsCreated: 0,
    errors: 0,
  };

  const maxLookups =
    options.maxLookupsPerShelf ?? DEFAULT_MAX_LOOKUPS_PER_SHELF;

  const whereClause = options.shelfId ? { id: options.shelfId } : {};
  const shelves = await prisma.hardcoverShelf.findMany({
    where: whereClause,
    include: { user: { select: { id: true, plexUsername: true } } },
  });

  if (shelves.length === 0) {
    log.info(
      options.shelfId
        ? 'Hardcover list not found'
        : 'No Hardcover lists configured, skipping',
    );
    return stats;
  }

  log.info(
    `Processing ${shelves.length} Hardcover list(s)${maxLookups > 0 ? ` (max ${maxLookups} lookups/list)` : ' (unlimited lookups)'}`,
  );

  for (const shelf of shelves) {
    try {
      await processShelf(shelf, stats, log, maxLookups);
      stats.shelvesProcessed++;
    } catch (error) {
      stats.errors++;
      log.error(
        `Failed to process list "${shelf.name}" for user ${shelf.user.plexUsername}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  log.info(
    `Hardcover sync complete: ${stats.shelvesProcessed} lists, ${stats.booksFound} books, ${stats.lookupsPerformed} lookups, ${stats.requestsCreated} requests created, ${stats.errors} errors`,
  );
  return stats;
}

async function processShelf(
  shelf: {
    id: string;
    listId: string;
    apiToken: string;
    name: string;
    user: { id: string; plexUsername: string };
  },
  stats: HardcoverSyncStats,
  log:
    | ReturnType<typeof RMABLogger.forJob>
    | ReturnType<typeof RMABLogger.create>,
  maxLookups: number,
) {
  log.info(
    `Fetching Hardcover List "${shelf.name}" (user: ${shelf.user.plexUsername})`,
  );

  const encryptionService = getEncryptionService();
  let decryptedToken = shelf.apiToken;
  try {
    // Check if the token is encrypted (our new storage method format)
    if (encryptionService.isEncryptedFormat(shelf.apiToken)) {
      decryptedToken = encryptionService.decrypt(shelf.apiToken);
    }
  } catch (err) {
    log.error(
      `Failed to decrypt API token for user ${shelf.user.plexUsername}`,
    );
  }

  let fetchedData: { listName: string; books: HardcoverApiBook[] };
  try {
    fetchedData = await fetchHardcoverList(decryptedToken, shelf.listId);
  } catch (error) {
    log.error(
      `Failed to fetch Hardcover list "${shelf.name}": ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return;
  }

  const books = fetchedData.books;
  stats.booksFound += books.length;
  log.info(
    `Found ${books.length} books in list "${shelf.name}" (Hardcover API)`,
  );

  let lookupsThisCycle = 0;
  const unlimitedLookups = maxLookups === 0;

  for (const book of books) {
    let mapping = await prisma.hardcoverBookMapping.findUnique({
      where: { hardcoverBookId: book.bookId },
    });

    if (!mapping) {
      if (!unlimitedLookups && lookupsThisCycle >= maxLookups) continue;

      mapping = await performAudibleLookup(book, log);
      lookupsThisCycle++;
      stats.lookupsPerformed++;

      if (!mapping?.audibleAsin) continue;
    }

    if (mapping.noMatch) {
      if (mapping.lastSearchAt) {
        const daysSinceSearch =
          (Date.now() - mapping.lastSearchAt.getTime()) / (1000 * 60 * 60 * 24);
        if (
          daysSinceSearch >= NO_MATCH_RETRY_DAYS &&
          (unlimitedLookups || lookupsThisCycle < maxLookups)
        ) {
          log.info(
            `Retrying Audible lookup for "${book.title}" (${NO_MATCH_RETRY_DAYS}+ days since last search)`,
          );
          mapping = await performAudibleLookup(book, log, mapping.id);
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
        const result = await createRequestForUser(shelf.user.id, {
          asin: mapping.audibleAsin,
          title: mapping.title,
          author: mapping.author,
          coverArtUrl: mapping.coverUrl || undefined,
        });

        if (result.success) {
          stats.requestsCreated++;
          log.info(
            `Created request for "${mapping.title}" by ${mapping.author} (ASIN: ${mapping.audibleAsin})`,
          );
        }
      } catch (error) {
        log.error(
          `Failed to create request for "${mapping.title}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }
  }

  // Collect enriched book data for display
  const bookIds = books.map((b) => b.bookId);
  const mappings =
    bookIds.length > 0
      ? await prisma.hardcoverBookMapping.findMany({
          where: { hardcoverBookId: { in: bookIds } },
          select: {
            hardcoverBookId: true,
            audibleAsin: true,
            title: true,
            author: true,
            coverUrl: true,
          },
        })
      : [];
  const mappingsByBookId = new Map(mappings.map((m) => [m.hardcoverBookId, m]));

  const matchedAsins = mappings
    .map((m) => m.audibleAsin)
    .filter((asin): asin is string => !!asin);
  const cachedCovers =
    matchedAsins.length > 0
      ? await prisma.audibleCache.findMany({
          where: { asin: { in: matchedAsins } },
          select: { asin: true, coverArtUrl: true, cachedCoverPath: true },
        })
      : [];
  const coverByAsin = new Map(
    cachedCovers
      .filter((c) => c.cachedCoverPath || c.coverArtUrl)
      .map((c) => {
        let coverUrl = c.coverArtUrl || '';
        if (c.cachedCoverPath) {
          const filename = c.cachedCoverPath.split('/').pop();
          coverUrl = `/api/cache/thumbnails/${filename}`;
        }
        return [c.asin, coverUrl] as const;
      }),
  );

  const bookData = books
    .map((b) => {
      const mapping = mappingsByBookId.get(b.bookId);
      const coverUrl =
        coverByAsin.get(mapping?.audibleAsin || '') ||
        mapping?.coverUrl ||
        b.coverUrl;
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

  const finalListName =
    fetchedData.listName !== 'Hardcover List'
      ? fetchedData.listName
      : shelf.name;

  await prisma.hardcoverShelf.update({
    where: { id: shelf.id },
    data: {
      name: finalListName,
      lastSyncAt: new Date(),
      bookCount: books.length,
      coverUrls: bookData.length > 0 ? JSON.stringify(bookData) : null,
    },
  });
}

async function performAudibleLookup(
  book: HardcoverApiBook,
  log:
    | ReturnType<typeof RMABLogger.forJob>
    | ReturnType<typeof RMABLogger.create>,
  existingMappingId?: string,
): Promise<any> {
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
        log.info(
          `No results with full title, retrying without series info: "${cleanQuery}"`,
        );
        searchResult = await audibleService.search(cleanQuery);
        firstResult = searchResult.results[0];
      }
    }

    if (firstResult?.asin) {
      log.info(
        `Audible match: "${book.title}" → ASIN ${firstResult.asin} ("${firstResult.title}" by ${firstResult.author})`,
      );

      const data = {
        title: firstResult.title,
        author: firstResult.author,
        audibleAsin: firstResult.asin,
        coverUrl: firstResult.coverArtUrl || book.coverUrl || null,
        noMatch: false,
        lastSearchAt: new Date(),
      };

      if (existingMappingId) {
        return prisma.hardcoverBookMapping.update({
          where: { id: existingMappingId },
          data,
        });
      }
      return prisma.hardcoverBookMapping.create({
        data: { hardcoverBookId: book.bookId, ...data },
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
      return prisma.hardcoverBookMapping.update({
        where: { id: existingMappingId },
        data: noMatchData,
      });
    }
    return prisma.hardcoverBookMapping.create({
      data: { hardcoverBookId: book.bookId, ...noMatchData },
    });
  } catch (error) {
    log.error(
      `Audible lookup failed for "${book.title}": ${error instanceof Error ? error.message : 'Unknown error'}`,
    );

    const errorData = {
      title: book.title,
      author: book.author,
      coverUrl: book.coverUrl || null,
      noMatch: true,
      lastSearchAt: new Date(),
    };

    if (existingMappingId) {
      return prisma.hardcoverBookMapping.update({
        where: { id: existingMappingId },
        data: errorData,
      });
    }
    return prisma.hardcoverBookMapping.create({
      data: { hardcoverBookId: book.bookId, ...errorData },
    });
  }
}
