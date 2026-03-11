/**
 * Component: Hardcover Shelf Sync Service
 * Documentation: documentation/backend/services/hardcover-sync.md
 *
 * Fetches Hardcover lists via GraphQL API and delegates book processing
 * to the shared shelf-sync-core service.
 */

import { prisma } from '@/lib/db';
import { Prisma } from '@/generated/prisma/client';
import { getEncryptionService } from '@/lib/services/encryption.service';
import { RMABLogger } from '@/lib/utils/logger';
import { fetchHardcoverList, HardcoverApiBook } from '@/lib/services/hardcover-api.service';
import {
  ShelfSyncStats,
  ShelfSyncOptions,
  createEmptyStats,
  resolveMaxLookups,
  processShelfBooks,
} from '@/lib/services/shelf-sync-core.service';

export { fetchHardcoverList } from '@/lib/services/hardcover-api.service';
export type { HardcoverApiBook } from '@/lib/services/hardcover-api.service';

const logger = RMABLogger.create('HardcoverSync');

// Re-export types that downstream consumers expect
export type { ShelfSyncStats as HardcoverSyncStats };
export type { ShelfSyncOptions as HardcoverSyncOptions };

/**
 * Process Hardcover shelves: fetch lists via GraphQL, resolve ASINs, create requests.
 * Called from the unified sync_reading_shelves processor.
 */
export async function processHardcoverShelves(
  jobLogger?: ReturnType<typeof RMABLogger.forJob>,
  options: ShelfSyncOptions = {},
): Promise<ShelfSyncStats> {
  const log = jobLogger || logger;
  const stats = createEmptyStats();
  const maxLookups = resolveMaxLookups(options);
  const whereClause: Prisma.HardcoverShelfWhereInput = {};
  if (options.shelfId) whereClause.id = options.shelfId;
  if (options.userId) whereClause.userId = options.userId;

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
      log.info(`Fetching Hardcover List "${shelf.name}" (user: ${shelf.user.plexUsername})`);

      const encryptionService = getEncryptionService();
      let decryptedToken = shelf.apiToken;
      try {
        if (encryptionService.isEncryptedFormat(shelf.apiToken)) {
          decryptedToken = encryptionService.decrypt(shelf.apiToken);
        }
      } catch (err) {
        log.error(`Failed to decrypt API token for user ${shelf.user.plexUsername}`);
        stats.errors++;
        continue;
      }

      let fetchedData: { listName: string; books: HardcoverApiBook[] };
      try {
        fetchedData = await fetchHardcoverList(decryptedToken, shelf.listId);
      } catch (error) {
        log.error(
          `Failed to fetch Hardcover list "${shelf.name}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        stats.errors++;
        continue;
      }

      log.info(`Found ${fetchedData.books.length} books in list "${shelf.name}" (Hardcover API)`);

      const bookData = await processShelfBooks(
        'hardcover', fetchedData.books, shelf.user.id, shelf.id, stats, log, maxLookups,
      );

      const finalListName =
        fetchedData.listName !== 'Hardcover List'
          ? fetchedData.listName
          : shelf.name;

      await prisma.hardcoverShelf.update({
        where: { id: shelf.id },
        data: {
          name: finalListName,
          lastSyncAt: new Date(),
          bookCount: fetchedData.books.length,
          coverUrls: bookData.length > 0 ? JSON.stringify(bookData) : null,
        },
      });

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
