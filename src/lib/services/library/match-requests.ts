/**
 * Component: Library scan step 6, match requests to the library (both scan jobs)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * Shared by the full library scan and the recently-added check. Every non-terminal audiobook
 * request is matched by the book's ASIN (findPlexMatch), as before. Audiobookshelf only: a
 * `downloaded` request whose book RMAB delivered (folder on record) is first linked to the library
 * item that holds that folder (request-library-link, #284). The link never writes the book's
 * ASIN or metadata. Both paths complete the request with a compare-and-set (the link: only from
 * `downloaded`; the ASIN match: from any non-terminal status), so two jobs in the same window
 * (full scan, recently-added checks) notify once, and only the winner writes the book's item id.
 * An ASIN match never overwrites a link made in the same run, and an item linked or ASIN-matched
 * earlier in the run is not handed to a later book. Ebook requests are never matched (they end at
 * `downloaded`).
 */

import { prisma } from '@/lib/db';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import type { RMABLogger } from '@/lib/utils/logger';
import type { LibraryItem } from './ILibraryService';
import {
  createLinkContext,
  deliveryTime,
  findDeliveredLibraryItem,
  logAmbiguousLink,
  markLinked,
  type LinkContext,
  type LinkResult,
} from './request-library-link';

export interface MatchRequestsResult {
  /** matchable requests considered */
  total: number;
  /** requests made available (ASIN match or link) */
  matched: number;
  linkedByPath: number;
  linkedByHash: number;
  ambiguous: number;
  /** links left undecided because an item could not be read (retried next run) */
  unknown: number;
}

/** Statuses a request is matched from; a request in any other status was completed meanwhile. */
const MATCHABLE_STATUS = { notIn: ['available', 'cancelled', 'denied'] };

type MatchableRequest = Awaited<ReturnType<typeof loadMatchableRequests>>[number];

function loadMatchableRequests() {
  return prisma.request.findMany({
    where: {
      type: 'audiobook', // Only match audiobook requests (ebooks don't go to 'available')
      status: MATCHABLE_STATUS,
      deletedAt: null,
    },
    include: {
      audiobook: true,
      user: { select: { plexUsername: true } },
    },
  });
}

async function notifyAvailable(request: MatchableRequest, logger: RMABLogger): Promise<void> {
  const { getJobQueueService } = await import('@/lib/services/job-queue.service');
  await getJobQueueService().addNotificationJob(
    'request_available',
    request.id,
    request.audiobook.title,
    request.audiobook.author,
    request.user.plexUsername || 'Unknown User',
    undefined,
    'audiobook'
  ).catch((error) => {
    logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
  });
}

const AVAILABLE_DATA = () => ({
  status: 'available',
  completedAt: new Date(),
  errorMessage: null,        // Clear any error state
  searchAttempts: 0,          // Reset retry counters
  downloadAttempts: 0,
  importAttempts: 0,
  updatedAt: new Date(),
});

/** The book's library item id, written only by the job whose compare-and-set won. */
async function recordItem(audiobookId: string, data: { absItemId: string } | { plexGuid: string }, logger: RMABLogger): Promise<void> {
  try {
    await prisma.audiobook.update({ where: { id: audiobookId }, data: { ...data, updatedAt: new Date() } });
  } catch (error) {
    logger.error(`Library item id of book ${audiobookId} not saved: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Link: `downloaded` → `available` only if still `downloaded`, then the item id on the book. */
async function completeLinked(request: MatchableRequest, plexGuid: string, via: string, logger: RMABLogger): Promise<boolean> {
  const { count } = await prisma.request.updateMany({
    where: { id: request.id, status: 'downloaded' },
    data: AVAILABLE_DATA(),
  });
  if (count !== 1) {
    logger.debug(`Request ${request.id} was completed by another job; no second notification`);
    return false;
  }
  await recordItem(request.audiobook.id, { absItemId: plexGuid }, logger);
  logger.info(`Linked "${request.audiobook.title}" to Audiobookshelf item ${plexGuid} by ${via} (delivered by RMAB)`);
  await notifyAvailable(request, logger);
  return true;
}

/**
 * The ASIN match lifted from the two scan jobs. The request update is a compare-and-set, and the
 * item id is written only when it won and this run did not link the book (`keepItem`).
 * Returns the matched item id when this job completed the request.
 */
async function matchByAsin(request: MatchableRequest, backendMode: string, keepItem: boolean, logger: RMABLogger): Promise<string | null> {
  const audiobook = request.audiobook;
  const match = await findPlexMatch({
    asin: audiobook.audibleAsin || '',
    title: audiobook.title,
    author: audiobook.author,
    narrator: audiobook.narrator || undefined,
  });
  if (!match) return null;

  const originalStatus = request.status;
  logger.info(
    `Match found! "${audiobook.title}" -> "${match.title}"` +
    (originalStatus !== 'downloaded' ? ` (was '${originalStatus}')` : '')
  );

  // Update request to available and clear any error state, unless another job already did
  const { count } = await prisma.request.updateMany({
    where: { id: request.id, status: MATCHABLE_STATUS },
    data: AVAILABLE_DATA(),
  });
  if (count !== 1) {
    logger.debug(`Request ${request.id} was completed by another job; no second notification`);
    return null;
  }
  if (!keepItem) {
    // plexGuid field stores the externalId from either backend
    await recordItem(audiobook.id, backendMode === 'audiobookshelf' ? { absItemId: match.plexGuid } : { plexGuid: match.plexGuid }, logger);
  }
  await notifyAvailable(request, logger);
  return match.plexGuid;
}

/**
 * Step 6 of both scan jobs. `listedItems` are the items this run listed (their isMissing saves
 * item fetches); `libraryId` limits the link to rows of this library.
 */
export async function matchRequestsToLibrary(opts: {
  backendMode: string;
  libraryId: string | null | undefined;
  listedItems: LibraryItem[];
  logger: RMABLogger;
}): Promise<MatchRequestsResult> {
  const { backendMode, libraryId, listedItems, logger } = opts;
  logger.info(`Checking for matchable requests...`);
  const requests = await loadMatchableRequests();
  logger.info(`Found ${requests.length} matchable requests (all non-terminal statuses)`);

  const result: MatchRequestsResult = { total: requests.length, matched: 0, linkedByPath: 0, linkedByHash: 0, ambiguous: 0, unknown: 0 };
  const linkable = backendMode === 'audiobookshelf' && !!libraryId;
  let ctx: LinkContext | null = null;
  let linkUnavailable = false;
  const links = new Map<string, LinkResult>(); // per audiobook and delivery time, once per run
  const linkedBooks = new Map<string, string>(); // audiobook id → the item this run linked it to

  for (const request of requests) {
    try {
      const audiobook = request.audiobook;
      if (linkable && !linkUnavailable && request.status === 'downloaded' && audiobook.filePath) {
        const deliveredAt = deliveryTime(request);
        const key = `${audiobook.id}@${deliveredAt.getTime()}`;
        let link = links.get(key);
        if (!link) {
          try {
            ctx ??= await createLinkContext({ libraryId: libraryId!, listedItems, logger });
            link = await findDeliveredLibraryItem(audiobook, deliveredAt, ctx);
          } catch (error) {
            linkUnavailable = true; // the ASIN match below still runs
            logger.error(`Library link unavailable for this run: ${error instanceof Error ? error.message : 'Unknown error'}`);
            link = { status: 'none' };
          }
          const earlier = linkedBooks.get(audiobook.id);
          if (link.status === 'linked' && earlier && earlier !== link.plexGuid) {
            link = { status: 'ambiguous', ids: [earlier, link.plexGuid] }; // two requests of one book, two items
          }
          links.set(key, link);
          if (link.status === 'linked') {
            markLinked(ctx!, link.plexGuid, audiobook.id);
            linkedBooks.set(audiobook.id, link.plexGuid);
          }
          if (link.status === 'ambiguous') {
            result.ambiguous++;
            logAmbiguousLink(audiobook, link.ids, logger);
          }
          if (link.status === 'unknown') {
            result.unknown++;
            logger.debug(`Library link: "${audiobook.title}" not decided (an Audiobookshelf item could not be read); the next run tries again`);
          }
        }
        if (link.status === 'linked') {
          if (await completeLinked(request, link.plexGuid, link.via, logger)) {
            result.matched++;
            if (link.via === 'path') result.linkedByPath++;
            else result.linkedByHash++;
          }
          continue;
        }
      }

      const keepItem = linkedBooks.has(audiobook.id);
      const item = await matchByAsin(request, backendMode, keepItem, logger);
      if (item) {
        result.matched++;
        if (ctx && !keepItem) markLinked(ctx, item, audiobook.id); // later fallbacks in this run skip it
      }
    } catch (error) {
      logger.error(`Failed to match request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  if (result.linkedByPath + result.linkedByHash + result.ambiguous + result.unknown > 0) {
    logger.info(
      `Library link: ${result.linkedByPath} by path, ${result.linkedByHash} by hash, ` +
      `${result.ambiguous} ambiguous, ${result.unknown} left for the next run (item not readable)`
    );
  }
  return result;
}
