/**
 * Component: Request Creator Service
 * Documentation: documentation/backend/services/goodreads-sync.md
 *
 * Shared request-creation logic used by the API route and the automatic callers (shelf sync, watched lists: `automatic: true`).
 * Encapsulates: duplicate detection, library check, Audnexus enrichment (the book's title and author
 * come from the looked-up metadata; the caller's values only fill a new book the lookup knows nothing of),
 * audiobook record creation, approval flow, notification queuing, and search job triggering.
 * Cover: a user's request takes the looked-up cover, else a sent one only on an Audible image host or a
 * cached thumbnail (coverForRequestedBook); automatic callers store the cover they found (sanitized).
 */

import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { RMABLogger } from '@/lib/utils/logger';
import { shouldWaitForRelease } from '@/lib/services/release-gate';
import { seedAsin, getSiblingAsins } from '@/lib/services/works.service';
import { isLibraryCoverSource, sanitizeCoverArtUrl } from '@/lib/utils/cover-art-url';
import { createRequestReplacing, RE_REQUESTABLE_STATUSES, RequestAlreadyReplacedError } from '@/lib/services/request-rerequest';
import { decideAutoReRequest, removedFromLibrarySkip, type AutoReRequestGo } from '@/lib/services/auto-rerequest';
import { coverForRequestedBook, detailsForNewBook, lookedUpTitleAuthorUpdates, lookUpBookDetails, type BookDetailsSource } from '@/lib/services/request-book-details';
import { resolveAutoApprove } from '@/lib/utils/permissions';
import { accessRequestRefusal, ALREADY_AVAILABLE, grantLibraryAccess } from '@/lib/services/library-access.service';

const logger = RMABLogger.create('RequestCreator');

export interface CreateRequestInput {
  asin: string;
  title: string;
  author: string;
  narrator?: string;
  description?: string;
  coverArtUrl?: string;
}

export interface CreateRequestOptions {
  skipAutoSearch?: boolean;
  /** When true, skip the per-user ignore list check (used for manual requests) */
  bypassIgnore?: boolean;
  /**
   * Shelf sync and watched lists: never replace a cancelled request, back off on failures (auto-rerequest.ts);
   * the cover they pass is stored as found (sanitized) rather than through coverForRequestedBook
   */
  automatic?: boolean;
  /** Mark the request Explicit (#542); a re-request keeps the replaced request's mark either way */
  explicit?: boolean;
}

export type CreateRequestResult =
  | { success: true; request: any }
  | { success: false; reason: 'already_available' | 'access_unavailable' | 'being_processed' | 'duplicate' | 'user_not_found' | 'ignored' | 'cancelled_by_user' | 'retry_not_due' | 'removed_from_library'; message: string };

/**
 * Create a request for a user, with full duplicate detection, library checks,
 * Audnexus enrichment, approval flow, notifications, and search job triggering. A manual request
 * for a book already in the library becomes an access request while requester tags are on
 * (library-access.service): no search; approval (or auto-approval) grants it.
 */
export async function createRequestForUser(
  userId: string,
  audiobook: CreateRequestInput,
  options: CreateRequestOptions = {}
): Promise<CreateRequestResult> {
  const { skipAutoSearch = false, bypassIgnore = false, automatic = false } = options;

  // Check for existing active request (downloaded/available) for this ASIN
  const existingActiveRequest = await prisma.request.findFirst({
    where: {
      audiobook: { audibleAsin: audiobook.asin },
      type: 'audiobook',
      status: { in: ['downloaded', 'available'] },
      deletedAt: null,
    },
  });

  // In the library: an access request (manual requests only) or refused
  let accessRequest = false;
  const inLibraryRefusal = async () => (automatic ? ALREADY_AVAILABLE : accessRequestRefusal(userId, audiobook.asin));

  if (existingActiveRequest) {
    if (existingActiveRequest.status !== 'available') {
      return { success: false, reason: 'being_processed', message: 'This audiobook is being processed and will be available soon' };
    }
    const refusal = await inLibraryRefusal();
    if (refusal) return refusal;
    accessRequest = true;
  }

  // A book removed from the library comes back only through a manual request (#214)
  const removedSkip = automatic ? await removedFromLibrarySkip(audiobook.asin) : null;
  if (removedSkip) return removedSkip;

  // Check if audiobook is already in Plex/ABS library
  const plexMatch = !accessRequest && await findPlexMatch({
    asin: audiobook.asin,
    title: audiobook.title,
    author: audiobook.author,
    narrator: audiobook.narrator,
  });

  if (plexMatch) {
    const refusal = await inLibraryRefusal();
    if (refusal) return refusal;
    accessRequest = true;
  }

  // Check per-user ignore list (skipped for manual requests via bypassIgnore)
  if (!bypassIgnore) {
    const isIgnored = await checkIgnoreList(userId, audiobook.asin);
    if (isIgnored) {
      return {
        success: false,
        reason: 'ignored',
        message: 'This audiobook is on your ignore list',
      };
    }
  }

  // Fetch full details from Audnexus (Audible catalog fallback) for title/author/year/series/releaseDate
  let lookedUp: BookDetailsSource | null = null;
  let year: number | undefined;
  let series: string | undefined;
  let seriesPart: string | undefined;
  let seriesAsin: string | undefined;
  let releaseDate: Date | null = null;
  try {
    const audnexusData = await lookUpBookDetails(audiobook.asin);
    lookedUp = audnexusData;

    if (audnexusData?.releaseDate) {
      try {
        const parsed = new Date(audnexusData.releaseDate);
        if (!isNaN(parsed.getTime())) {
          releaseDate = parsed;
          const releaseYear = parsed.getFullYear();
          if (!isNaN(releaseYear)) {
            year = releaseYear;
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
    if (audnexusData?.series) series = audnexusData.series;
    if (audnexusData?.seriesPart) seriesPart = audnexusData.seriesPart;
    if (audnexusData?.seriesAsin) seriesAsin = audnexusData.seriesAsin;
  } catch (error) {
    logger.warn(`Failed to fetch Audnexus data for ASIN ${audiobook.asin}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Cover: a user's request takes the looked-up cover, else a sent Audible image (or cached thumbnail), else none
  const safeCoverArtUrl = automatic
    ? sanitizeCoverArtUrl(audiobook.coverArtUrl)
    : coverForRequestedBook(lookedUp, audiobook.coverArtUrl);

  // Find or create audiobook record
  let audiobookRecord = await prisma.audiobook.findFirst({
    where: { audibleAsin: audiobook.asin },
  });

  if (!audiobookRecord) {
    audiobookRecord = await prisma.audiobook.create({
      data: {
        audibleAsin: audiobook.asin,
        ...detailsForNewBook(lookedUp, audiobook),
        coverArtUrl: safeCoverArtUrl,
        year,
        series,
        seriesPart,
        seriesAsin,
        status: 'requested',
      },
    });
    logger.debug(`Created audiobook ${audiobookRecord.id} for ASIN ${audiobook.asin}`);
  } else {
    // Update existing record with clean metadata (e.g. Audnexus title replacing Goodreads title);
    // the saved title and author change only to looked-up values, never to the caller's
    const updates: Record<string, any> = { ...lookedUpTitleAuthorUpdates(lookedUp, audiobookRecord) };
    // Fill a missing cover, or upgrade one the library can't use (e.g. a shelf-sync fallback) to one it can
    const existingCover = sanitizeCoverArtUrl(audiobookRecord.coverArtUrl);
    if (safeCoverArtUrl && (!existingCover || (!isLibraryCoverSource(existingCover) && isLibraryCoverSource(safeCoverArtUrl)))) {
      updates.coverArtUrl = safeCoverArtUrl;
    }
    if (year) updates.year = year;
    if (series) updates.series = series;
    if (seriesPart) updates.seriesPart = seriesPart;
    if (seriesAsin) updates.seriesAsin = seriesAsin;

    if (Object.keys(updates).length > 0) {
      audiobookRecord = await prisma.audiobook.update({
        where: { id: audiobookRecord.id },
        data: updates,
      });
    }
  }

  // Seed works table for cross-ASIN matching (Layer 2: request-time seeding)
  seedAsin(
    audiobook.asin,
    audiobookRecord.title,
    audiobookRecord.author,
    audiobookRecord.narrator || undefined,
    undefined // duration not available at request time
  ).catch(() => {});

  // Check if user already has an active request for this audiobook
  const existingRequest = await prisma.request.findFirst({
    where: {
      userId,
      audiobookId: audiobookRecord.id,
      type: 'audiobook',
      deletedAt: null,
    },
  });

  // A failed/warn/cancelled request is replaced by the new one (atomically, below),
  // keeping its blocklist; it is not touched until the new request is created
  let replacesRequest: { id: string; customSearchTerms: string | null; explicit: boolean } | null = null;
  let autoReRequest: AutoReRequestGo | undefined; // set only by automatic callers; user requests start at count 0
  if (existingRequest) {
    if (!RE_REQUESTABLE_STATUSES.includes(existingRequest.status)) {
      return {
        success: false,
        reason: 'duplicate',
        message: 'You have already requested this audiobook',
      };
    }
    if (automatic) {
      const decision = await decideAutoReRequest(existingRequest, audiobookRecord.title);
      if (decision.skip) return decision.skip;
      autoReRequest = decision;
    }
    replacesRequest = { id: existingRequest.id, customSearchTerms: existingRequest.customSearchTerms ?? null, explicit: existingRequest.explicit === true };
  }

  // Check ANY user's active request for same audiobook (avoid duplicate processing)
  const anyActiveRequest = await prisma.request.findFirst({
    where: {
      audiobookId: audiobookRecord.id,
      type: 'audiobook',
      status: { notIn: ['failed', 'warn', 'cancelled', 'available', 'downloaded'] },
      deletedAt: null,
    },
  });

  if (anyActiveRequest && anyActiveRequest.userId !== userId && !accessRequest) {
    return {
      success: false,
      reason: 'being_processed',
      message: 'This audiobook is already being requested by another user',
    };
  }

  let shouldTriggerSearch = !skipAutoSearch;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, autoApproveRequests: true, plexUsername: true },
  });

  if (!user) {
    return { success: false, reason: 'user_not_found', message: 'User not found' };
  }

  const needsApproval = !(await resolveAutoApprove(user.role, user.autoApproveRequests));

  // Evaluate release-date gate (skip-unreleased-auto-search); admin approval applies the same check
  const releaseGateSkip = !needsApproval && !skipAutoSearch && !accessRequest && await shouldWaitForRelease(releaseDate);

  let initialStatus: string;
  if (needsApproval || accessRequest) {
    // An access request waits here even when auto-approved; it is granted right after creation
    initialStatus = 'awaiting_approval';
    shouldTriggerSearch = false;
  } else if (skipAutoSearch) {
    initialStatus = 'awaiting_search';
  } else if (releaseGateSkip) {
    initialStatus = 'awaiting_release';
    shouldTriggerSearch = false;
  } else {
    initialStatus = 'pending';
  }

  // Create the request (replacing a failed one keeps its blocklist and search terms)
  let newRequest;
  try {
    newRequest = await createRequestReplacing(
      {
        data: {
          userId,
          audiobookId: audiobookRecord.id,
          status: initialStatus,
          type: 'audiobook',
          progress: 0,
          releaseDate,
          // Only an admin clears a mark (#542): a re-request can add one, never drop one
          explicit: options.explicit === true || replacesRequest?.explicit === true,
          ...(accessRequest ? { accessRequest: true } : {}),
          ...(replacesRequest?.customSearchTerms && { customSearchTerms: replacesRequest.customSearchTerms }),
          ...(autoReRequest && { autoRerequestCount: autoReRequest.nextCount }),
        },
        include: {
          audiobook: true,
          user: { select: { id: true, plexUsername: true } },
        },
      },
      replacesRequest?.id ?? null
    );
  } catch (error) {
    if (error instanceof RequestAlreadyReplacedError) {
      logger.info(`Request ${error.requestId} was re-requested concurrently; not creating a second request`);
      return { success: false, reason: 'duplicate', message: 'You have already requested this audiobook' };
    }
    throw error;
  }
  if (replacesRequest) {
    logger.debug(`Replaced ${existingRequest?.status} request ${replacesRequest.id} with ${newRequest.id} (blocklist carried over)`);
    if (autoReRequest) logger.info(`${autoReRequest.logLine} (new request ${newRequest.id})`);
  }

  if (releaseGateSkip) {
    logger.info(`Skipped auto-search for unreleased book`, {
      gateSource: 'InitialAutoSearch',
      requestId: newRequest.id,
      audiobookTitle: audiobookRecord.title,
      releaseDate: releaseDate?.toISOString() ?? null,
    });
  }

  // Auto-approved access request: granted now (no search). Left waiting for an admin if the book
  // left the library meanwhile (approval then searches), with the usual pending notification.
  if (accessRequest && !needsApproval) {
    const grant = await grantLibraryAccess(newRequest.id, logger);
    if (grant.granted) return { success: true, request: grant.request };
  }

  const jobQueue = getJobQueueService();

  // Send notification
  const notificationType = initialStatus === 'awaiting_approval' ? 'request_pending_approval' : 'request_approved';
  await jobQueue.addNotificationJob(
    notificationType,
    newRequest.id,
    audiobookRecord.title,
    audiobookRecord.author,
    user.plexUsername || 'Unknown User'
  ).catch((error) => {
    logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
  });

  // Trigger search job
  if (shouldTriggerSearch) {
    await jobQueue.addSearchJob(newRequest.id, {
      id: audiobookRecord.id,
      title: audiobookRecord.title,
      author: audiobookRecord.author,
      asin: audiobookRecord.audibleAsin || undefined,
    });
  }

  return { success: true, request: newRequest };
}

/**
 * Check if an ASIN (or any of its sibling ASINs via the works table)
 * is on the user's ignore list. Returns true if the book should be blocked.
 */
async function checkIgnoreList(userId: string, asin: string): Promise<boolean> {
  // Direct check: is this exact ASIN ignored?
  const directIgnore = await prisma.ignoredAudiobook.findUnique({
    where: { userId_asin: { userId, asin } },
  });
  if (directIgnore) return true;

  // Works-system expansion: check sibling ASINs
  try {
    const siblingMap = await getSiblingAsins([asin]);
    const siblings = siblingMap.get(asin);
    if (siblings && siblings.length > 0) {
      const siblingIgnore = await prisma.ignoredAudiobook.findFirst({
        where: {
          userId,
          asin: { in: siblings },
        },
      });
      if (siblingIgnore) return true;
    }
  } catch {
    // Works expansion is best-effort — if it fails, only direct check applies
  }

  return false;
}
