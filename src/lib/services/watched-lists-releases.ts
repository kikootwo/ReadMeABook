/**
 * Component: Watched Lists Release Filter & Author Scan
 * Documentation: documentation/features/watched-lists.md
 *
 * New-releases-only support for watched authors and series:
 * - booksForWatch(): per-watch release cutoff (undated books are skipped under new-only).
 * - scanAuthorBooks(): one author catalog scan, relevance order (entire catalog, as before)
 *   or newest first with an early stop at the cutoff (new releases only).
 * - scanAuthorLegs(): runs the scans an author's watchers need and feeds each watcher its own.
 */

import { getAudibleService, AudibleAudiobook, AuthorBooksResult, AUDIBLE_PAGE_SIZE } from '@/lib/integrations/audible.service';
import { deduplicateAndCollectGroups } from '@/lib/utils/deduplicate-audiobooks';
import { persistDedupGroups } from '@/lib/services/works.service';
import { toReleaseDay } from '@/lib/utils/release-date';
import { isNewRelease, newReleaseFloorDay } from '@/lib/utils/watch-mode';
import type { RMABLogger } from '@/lib/utils/logger';

/** Max author catalog pages per scan */
export const MAX_AUTHOR_PAGES = 4;

/** Delay between author catalog pages (ms) */
const PAGE_DELAY_MS = 1000;

interface Watch {
  newReleasesSince?: Date | null;
}

/**
 * Dedupe a scraped list. Its dedup groups are persisted in the background once `after` settles,
 * so two lists of the same author never write the same works at the same time.
 */
export function dedupeAndPersist(
  books: AudibleAudiobook[],
  after: Promise<void> = Promise.resolve()
): { books: AudibleAudiobook[]; persisted: Promise<void> } {
  if (books.length === 0) return { books: [], persisted: after };
  const { books: deduped, groups } = deduplicateAndCollectGroups(books);
  const persisted = groups.length > 0
    ? after.then(() => persistDedupGroups(groups)).catch(() => {})
    : after;
  return { books: deduped, persisted };
}

/**
 * The books a watch should request from: all of them for entire catalog; for new releases only,
 * those released on or after the cutoff's floor day. Logs one count line per watch.
 */
export function booksForWatch(
  books: AudibleAudiobook[],
  watch: Watch,
  label: string,
  stats: { skippedBeforeCutoff: number },
  log: RMABLogger
): AudibleAudiobook[] {
  const since = watch.newReleasesSince;
  if (since == null) return books;

  const kept = books.filter((b) => isNewRelease(b.releaseDate, since));
  const skipped = books.length - kept.length;
  if (skipped > 0) {
    const undated = books.filter((b) => toReleaseDay(b.releaseDate) === null).length;
    stats.skippedBeforeCutoff += skipped;
    log.info(
      `New releases only for ${label}: skipped ${skipped - undated} released before ${newReleaseFloorDay(since)}, ${undated} undated`
    );
  }
  return kept;
}

/**
 * Scan an author's catalog.
 * - No `since`: relevance order, stops at a page with no matching books or when Audible has no more.
 *   `complete` = Audible reported no further pages within the page cap (the whole catalog was read).
 * - With `since`: newest first; stops after the first page holding a book released before the
 *   cutoff's floor day. A page with no matching books (other languages or namesakes) doesn't end it.
 */
export async function scanAuthorBooks(
  authorName: string,
  authorAsin: string,
  log: RMABLogger,
  { since }: { since?: Date | null } = {}
): Promise<{ books: AudibleAudiobook[]; complete: boolean }> {
  const audible = getAudibleService();
  const floorDay = since ? newReleaseFloorDay(since) : null;
  const books: AudibleAudiobook[] = [];

  for (let page = 1; page <= MAX_AUTHOR_PAGES; page++) {
    let result: AuthorBooksResult;
    try {
      result = floorDay
        ? await audible.searchByAuthorAsin(authorName, authorAsin, page, { newestFirst: true })
        : await audible.searchByAuthorAsin(authorName, authorAsin, page);
    } catch (error) {
      log.error(`Failed to scrape author page ${page} for "${authorName}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }

    books.push(...result.books);

    if (floorDay) {
      const pastCutoff = result.books.some((b) => {
        const day = toReleaseDay(b.releaseDate);
        return day !== null && day < floorDay;
      });
      const more = result.totalResults > 0 ? result.totalResults > page * AUDIBLE_PAGE_SIZE : result.hasMore;
      if (pastCutoff || !more) break;
    } else if (!result.hasMore) {
      return { books, complete: true };
    } else if (result.books.length === 0) {
      break;
    }

    if (page < MAX_AUTHOR_PAGES) await delay(PAGE_DELAY_MS);
  }

  return { books, complete: false };
}

/**
 * Scan an author for all of its watchers. Entire-catalog watchers get the relevance scan;
 * new-only watchers get a newest-first scan stopping at the earliest new-only cutoff, unless the
 * relevance scan already read the whole catalog (then they are fed from it; booksForWatch applies
 * each cutoff). An author with only entire-catalog watchers gets exactly one relevance scan.
 */
export async function scanAuthorLegs(
  authorName: string,
  authorAsin: string,
  watches: Watch[],
  log: RMABLogger
): Promise<{ found: number; booksFor: (watch: Watch) => AudibleAudiobook[] }> {
  const cutoffs = watches.map((w) => w.newReleasesSince).filter((d): d is Date => d != null);
  const needEntire = cutoffs.length < watches.length;
  const earliest = cutoffs.length > 0 ? new Date(Math.min(...cutoffs.map((d) => d.getTime()))) : null;

  const entireScan = needEntire ? await scanAuthorBooks(authorName, authorAsin, log) : { books: [], complete: false };
  const entireRaw = entireScan.books;
  let newRaw: AudibleAudiobook[] = [];
  if (earliest && !entireScan.complete) {
    if (needEntire) await delay(PAGE_DELAY_MS);
    newRaw = (await scanAuthorBooks(authorName, authorAsin, log, { since: earliest })).books;
  }

  const entireAsins = new Set(entireRaw.map((b) => b.asin));
  const found = entireRaw.length + newRaw.filter((b) => !entireAsins.has(b.asin)).length;

  const entire = dedupeAndPersist(entireRaw);
  const newOnly = entireScan.complete ? entire : dedupeAndPersist(newRaw, entire.persisted);
  return { found, booksFor: (watch) => (watch.newReleasesSince != null ? newOnly.books : entire.books) };
}

/** Wait between Audible requests */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
