/**
 * Component: Audible Refresh Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Fetches popular, new release, and category audiobooks from Audible and caches them.
 * All section data is stored uniformly in AudibleCacheCategory with reserved IDs
 * '__popular__' and '__new_releases__' for built-in sections.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';

/** Reserved category IDs for built-in home sections */
export const POPULAR_CATEGORY_ID = '__popular__';
export const NEW_RELEASES_CATEGORY_ID = '__new_releases__';

/**
 * Most distinct category sections refreshed per run. Each costs a 10-20 s cooldown and
 * up to 4 search pages; 30 covers every top-level category (24 on audible.com) with
 * room for sub-categories, and keeps the category pass to roughly 15-25 minutes.
 */
export const MAX_REFRESHED_CATEGORIES = 30;

/**
 * Distinct category ids to refresh this run, stalest first: never stored, then the one
 * stored longest ago (`lastSyncedAt`), then the most users, then id. A refreshed id moves
 * to the back, so over the cap every category refreshes within ceil(N / cap) runs.
 * The rest are skipped this run and keep their data.
 */
export function selectCategoriesToRefresh(
  chosenIds: (string | null)[],
  lastSyncedAt: ReadonlyMap<string, Date> = new Map(),
  cap: number = MAX_REFRESHED_CATEGORIES,
): { categoryIds: string[]; skipped: string[] } {
  const counts = new Map<string, number>();
  for (const id of chosenIds) {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  // Never stored (-1) sorts before any stored time.
  const storedAt = (id: string) => lastSyncedAt.get(id)?.getTime() ?? -1;
  const ranked = [...counts.entries()]
    .sort(([a, na], [b, nb]) =>
      storedAt(a) - storedAt(b) || nb - na || (a < b ? -1 : a > b ? 1 : 0))
    .map(([id]) => id);
  return { categoryIds: ranked.slice(0, cap), skipped: ranked.slice(cap) };
}

/** When each category's books were last stored: one row per category that has any. */
async function loadLastSyncedAt(categoryIds: string[]): Promise<Map<string, Date>> {
  if (categoryIds.length === 0) return new Map();
  const rows = await prisma.audibleCacheCategory.groupBy({
    by: ['categoryId'],
    where: { categoryId: { in: categoryIds } },
    _max: { lastSyncedAt: true },
  });
  const stored = new Map<string, Date>();
  for (const row of rows) {
    if (row._max.lastSyncedAt) stored.set(row.categoryId, row._max.lastSyncedAt);
  }
  return stored;
}

export interface AudibleRefreshPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processAudibleRefresh(payload: AudibleRefreshPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'AudibleRefresh');

  logger.info('Starting Audible data refresh...');

  const { getAudibleService } = await import('../integrations/audible.service');
  const { getThumbnailCacheService } = await import('../services/thumbnail-cache.service');
  const audibleService = getAudibleService();
  const thumbnailCache = getThumbnailCacheService();

  try {
    const syncTime = new Date();

    // Fetch popular and new releases - 200 items each
    const popular = await audibleService.getPopularAudiobooks(200);

    // Batch cooldown between popular and new releases to reduce detection
    const batchCooldownMs = 15000 + Math.floor(Math.random() * 15000);
    logger.info(`Batch cooldown: waiting ${Math.round(batchCooldownMs / 1000)}s before fetching new releases...`);
    await new Promise(resolve => setTimeout(resolve, batchCooldownMs));

    const newReleases = await audibleService.getNewReleases(200);

    logger.info(`Fetched ${popular.length} popular, ${newReleases.length} new releases from Audible`);

    // Persist popular audiobooks via AudibleCacheCategory
    const popularSaved = await persistSectionBooks(
      popular, POPULAR_CATEGORY_ID, syncTime, thumbnailCache, logger, 'popular audiobook'
    );

    // Persist new releases via AudibleCacheCategory
    const newReleasesSaved = await persistSectionBooks(
      newReleases, NEW_RELEASES_CATEGORY_ID, syncTime, thumbnailCache, logger, 'new release'
    );

    logger.info(`Saved ${popularSaved} popular and ${newReleasesSaved} new releases`);

    // --- Category scraping ---
    // Distinct categoryIds from all users' home sections, capped per run
    let categoriesSynced = 0;
    let categoriesSkipped = 0;
    try {
      const categorySections = await prisma.userHomeSection.findMany({
        where: { sectionType: 'category', categoryId: { not: null } },
        select: { categoryId: true },
      });

      const chosenIds = categorySections.map((s) => s.categoryId);
      const distinctIds = [...new Set(chosenIds.filter((id): id is string => !!id))];
      const lastSyncedAt = distinctIds.length > MAX_REFRESHED_CATEGORIES
        ? await loadLastSyncedAt(distinctIds)
        : new Map<string, Date>();
      const { categoryIds, skipped } = selectCategoriesToRefresh(chosenIds, lastSyncedAt);
      categoriesSkipped = skipped.length;
      if (skipped.length > 0) {
        logger.warn(
          `${skipped.length} category section(s) over the ${MAX_REFRESHED_CATEGORIES}-category refresh cap wait for a later run (stalest first), keeping their previous data: ${skipped.join(', ')}`,
        );
      }

      if (categoryIds.length > 0) {
        logger.info(`Refreshing ${categoryIds.length} user-configured categories...`);

        for (const catId of categoryIds) {
          try {
            // Batch cooldown between categories
            const catCooldownMs = 10000 + Math.floor(Math.random() * 10000);
            logger.info(`Category cooldown: waiting ${Math.round(catCooldownMs / 1000)}s before category ${catId}...`);
            await new Promise(resolve => setTimeout(resolve, catCooldownMs));

            // Scrape category books
            const books = await audibleService.getCategoryBooks(catId, 200);
            logger.info(`Category ${catId}: fetched ${books.length} books`);

            const saved = await persistSectionBooks(
              books, catId, syncTime, thumbnailCache, logger, 'category book'
            );

            categoriesSynced++;
            logger.info(`Category ${catId}: saved ${saved} entries`);
          } catch (error) {
            logger.error(`Failed to refresh category ${catId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        logger.info(`Category refresh complete: ${categoriesSynced}/${categoryIds.length} categories synced`);
      }
    } catch (error) {
      logger.error(`Category refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Cleanup unused thumbnails
    logger.info('Cleaning up unused thumbnails...');
    const allActiveAsins = await prisma.audibleCache.findMany({
      select: { asin: true },
    });
    const activeAsinSet = new Set(allActiveAsins.map(item => item.asin));
    const deletedCount = await thumbnailCache.cleanupUnusedThumbnails(activeAsinSet);
    logger.info(`Cleanup complete: ${deletedCount} unused thumbnails removed`);

    return {
      success: true,
      message: 'Audible refresh completed',
      popularSaved,
      newReleasesSaved,
      categoriesSynced,
      categoriesSkipped,
      thumbnailsDeleted: deletedCount,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}

/**
 * Wipe previous entries for a category, upsert book metadata into AudibleCache,
 * and insert ranked entries into AudibleCacheCategory.
 * Returns the number of books successfully saved.
 */
async function persistSectionBooks(
  books: any[],
  categoryId: string,
  syncTime: Date,
  thumbnailCache: { cacheThumbnail: (asin: string, url: string) => Promise<string | null> },
  logger: ReturnType<typeof RMABLogger.forJob>,
  labelForErrors: string,
): Promise<number> {
  // Defensive dedup: the (asin, categoryId) unique constraint means a duplicate ASIN
  // in `books` crashes the second .create() with P2002. The HTML parser already dedupes
  // per page and across pages against the cumulative accumulator, but a warn-on-fire
  // signal here lets us detect upstream surprises (e.g. Audible serving the same item
  // in both a carousel and the main grid) without the noisy duplicate-key Postgres
  // errors. Keep the first occurrence so Audible's editorial ordering is preserved.
  const seenAsins = new Set<string>();
  const dedupedBooks = books.filter((b) => {
    if (!b?.asin || seenAsins.has(b.asin)) return false;
    seenAsins.add(b.asin);
    return true;
  });
  const droppedCount = books.length - dedupedBooks.length;
  if (droppedCount > 0) {
    logger.warn(
      `Dropped ${droppedCount} duplicate ASIN(s) from ${categoryId} input list before persist`,
    );
  }

  // Wipe previous entries for this section
  logger.info(`Clearing previous data for ${categoryId}...`);
  await prisma.audibleCacheCategory.deleteMany({
    where: { categoryId },
  });
  logger.info(
    `Cleared previous entries for ${categoryId}, saving ${dedupedBooks.length} books...`,
  );

  let saved = 0;
  for (let i = 0; i < dedupedBooks.length; i++) {
    const book = dedupedBooks[i];
    try {
      // Cache thumbnail if coverArtUrl exists
      let cachedCoverPath: string | null = null;
      if (book.coverArtUrl) {
        cachedCoverPath = await thumbnailCache.cacheThumbnail(book.asin, book.coverArtUrl);
        if (!cachedCoverPath) {
          logger.warn(`Cover cache failed for "${book.title}" (${book.asin}) - falling back to remote URL`);
        }
      }

      // Upsert book metadata into AudibleCache
      await prisma.audibleCache.upsert({
        where: { asin: book.asin },
        create: {
          asin: book.asin,
          title: book.title,
          author: book.author,
          narrator: book.narrator,
          description: book.description,
          coverArtUrl: book.coverArtUrl,
          cachedCoverPath,
          durationMinutes: book.durationMinutes,
          releaseDate: book.releaseDate ? new Date(book.releaseDate) : null,
          rating: book.rating ? book.rating : null,
          genres: book.genres || [],
          lastSyncedAt: syncTime,
        },
        update: {
          title: book.title,
          author: book.author,
          narrator: book.narrator,
          description: book.description,
          coverArtUrl: book.coverArtUrl,
          cachedCoverPath,
          durationMinutes: book.durationMinutes,
          releaseDate: book.releaseDate ? new Date(book.releaseDate) : null,
          rating: book.rating ? book.rating : null,
          genres: book.genres || [],
          lastSyncedAt: syncTime,
        },
      });

      // Insert ranked entry into AudibleCacheCategory
      await prisma.audibleCacheCategory.create({
        data: {
          asin: book.asin,
          categoryId,
          rank: i + 1,
          lastSyncedAt: syncTime,
        },
      });

      saved++;
    } catch (error) {
      logger.error(`Failed to save ${labelForErrors} ${book.title}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return saved;
}
