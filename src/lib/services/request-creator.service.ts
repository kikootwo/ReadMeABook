/**
 * Component: Request Creator Service
 * Documentation: documentation/backend/services/requests.md
 *
 * Shared request-creation logic used by both the API route and Goodreads sync.
 * Encapsulates: duplicate detection, library check, Audnexus enrichment,
 * audiobook record creation, approval flow, notification queuing, and search job triggering.
 */

import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { getConfigService } from '@/lib/services/config.service';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { RMABLogger } from '@/lib/utils/logger';
import { shouldSkipAutoSearch } from '@/lib/utils/release-date';
import { seedAsin, getSiblingAsins } from '@/lib/services/works.service';
import { detectBundle, enumerateSeriesBooks } from '@/lib/services/series-bundle.service';

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
   * Internal flag set when fanning out a series bundle into per-book requests.
   * Disables bundle re-detection so a split-out book can't recursively re-split.
   */
  bundleDecomposed?: boolean;
}

export type CreateRequestResult =
  | { success: true; request: any }
  | { success: true; decomposed: true; count: number; books: { asin: string; title: string }[]; message: string }
  | { success: false; reason: 'already_available' | 'being_processed' | 'duplicate' | 'user_not_found' | 'ignored'; message: string };

/**
 * Create a request for a user, with full duplicate detection, library checks,
 * Audnexus enrichment, approval flow, notifications, and search job triggering.
 */
export async function createRequestForUser(
  userId: string,
  audiobook: CreateRequestInput,
  options: CreateRequestOptions = {}
): Promise<CreateRequestResult> {
  const { skipAutoSearch = false, bypassIgnore = false, bundleDecomposed = false } = options;

  // Check for existing active request (downloaded/available) for this ASIN
  const existingActiveRequest = await prisma.request.findFirst({
    where: {
      audiobook: { audibleAsin: audiobook.asin },
      type: 'audiobook',
      status: { in: ['downloaded', 'available'] },
      deletedAt: null,
    },
  });

  if (existingActiveRequest) {
    const status = existingActiveRequest.status;
    return {
      success: false,
      reason: status === 'available' ? 'already_available' : 'being_processed',
      message: status === 'available'
        ? 'This audiobook is already available in your library'
        : 'This audiobook is being processed and will be available soon',
    };
  }

  // Check if audiobook is already in Plex/ABS library
  const plexMatch = await findPlexMatch({
    asin: audiobook.asin,
    title: audiobook.title,
    author: audiobook.author,
    narrator: audiobook.narrator,
  });

  if (plexMatch) {
    return {
      success: false,
      reason: 'already_available',
      message: 'This audiobook is already available in your library',
    };
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

  // Fetch full details from Audnexus for year/series/releaseDate
  let year: number | undefined;
  let series: string | undefined;
  let seriesPart: string | undefined;
  let seriesAsin: string | undefined;
  let durationMinutes: number | undefined;
  let releaseDate: Date | null = null;
  try {
    const audibleService = getAudibleService();
    const audnexusData = await audibleService.getAudiobookDetails(audiobook.asin);

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
    if (audnexusData?.durationMinutes) durationMinutes = audnexusData.durationMinutes;
  } catch (error) {
    logger.warn(`Failed to fetch Audnexus data for ASIN ${audiobook.asin}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Series-bundle decomposition: if this request is actually a multi-book series
  // bundle (e.g. "Mistborn Trilogy"), fan out into per-book requests instead of
  // trying to download the bundle as one item. Skipped when we're already
  // processing a split-out book (bundleDecomposed) to prevent recursion.
  if (!bundleDecomposed) {
    const detection = detectBundle({
      title: audiobook.title,
      seriesPart,
      seriesAsin,
      durationMinutes,
    });

    if (detection.isBundle && seriesAsin) {
      const decomposed = await decomposeBundle(
        userId,
        audiobook,
        seriesAsin,
        detection.range,
        options
      );
      if (decomposed) return decomposed;
      // Enumeration produced no usable books — fall through to normal handling.
      logger.warn(`Bundle detected for "${audiobook.title}" but no books enumerated; treating as a normal request`);
    }
  }

  // Find or create audiobook record
  let audiobookRecord = await prisma.audiobook.findFirst({
    where: { audibleAsin: audiobook.asin },
  });

  if (!audiobookRecord) {
    audiobookRecord = await prisma.audiobook.create({
      data: {
        audibleAsin: audiobook.asin,
        title: audiobook.title,
        author: audiobook.author,
        narrator: audiobook.narrator,
        description: audiobook.description,
        coverArtUrl: audiobook.coverArtUrl,
        year,
        series,
        seriesPart,
        seriesAsin,
        status: 'requested',
      },
    });
    logger.debug(`Created audiobook ${audiobookRecord.id} for ASIN ${audiobook.asin}`);
  } else {
    // Update existing record with clean metadata (e.g. Audnexus title replacing Goodreads title)
    const updates: Record<string, any> = {};
    if (audiobook.title && audiobook.title !== audiobookRecord.title) updates.title = audiobook.title;
    if (audiobook.author && audiobook.author !== audiobookRecord.author) updates.author = audiobook.author;
    if (audiobook.coverArtUrl && !audiobookRecord.coverArtUrl) updates.coverArtUrl = audiobook.coverArtUrl;
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

  if (existingRequest) {
    const canReRequest = ['failed', 'warn', 'cancelled'].includes(existingRequest.status);
    if (!canReRequest) {
      return {
        success: false,
        reason: 'duplicate',
        message: 'You have already requested this audiobook',
      };
    }
    // Delete existing failed/warn/cancelled request
    logger.debug(`Deleting existing ${existingRequest.status} request ${existingRequest.id} to allow re-request`);
    await prisma.request.delete({ where: { id: existingRequest.id } });
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

  if (anyActiveRequest && anyActiveRequest.userId !== userId) {
    return {
      success: false,
      reason: 'being_processed',
      message: 'This audiobook is already being requested by another user',
    };
  }

  // Determine if approval is needed
  let needsApproval = false;
  let shouldTriggerSearch = !skipAutoSearch;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, autoApproveRequests: true, plexUsername: true },
  });

  if (!user) {
    return { success: false, reason: 'user_not_found', message: 'User not found' };
  }

  if (user.role === 'admin') {
    needsApproval = false;
  } else {
    if (user.autoApproveRequests === true) {
      needsApproval = false;
    } else if (user.autoApproveRequests === false) {
      needsApproval = true;
    } else {
      const globalConfig = await prisma.configuration.findUnique({
        where: { key: 'auto_approve_requests' },
      });
      const globalAutoApprove = globalConfig === null ? true : globalConfig.value === 'true';
      needsApproval = !globalAutoApprove;
    }
  }

  // Evaluate release-date gate (skip-unreleased-auto-search)
  let releaseGateSkip = false;
  if (!needsApproval && !skipAutoSearch) {
    try {
      const configService = getConfigService();
      const skipUnreleasedSetting = (await configService.get('indexer.skip_unreleased')) !== 'false';
      const gate = shouldSkipAutoSearch({ releaseDate }, skipUnreleasedSetting);
      releaseGateSkip = gate.skip;
    } catch (error) {
      logger.warn(`Failed to evaluate release-date gate: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  let initialStatus: string;
  if (needsApproval) {
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

  // Create request
  const newRequest = await prisma.request.create({
    data: {
      userId,
      audiobookId: audiobookRecord.id,
      status: initialStatus,
      type: 'audiobook',
      progress: 0,
      releaseDate,
    },
    include: {
      audiobook: true,
      user: { select: { id: true, plexUsername: true } },
    },
  });

  if (releaseGateSkip) {
    logger.info(`Skipped auto-search for unreleased book`, {
      gateSource: 'InitialAutoSearch',
      requestId: newRequest.id,
      audiobookTitle: audiobookRecord.title,
      releaseDate: releaseDate?.toISOString() ?? null,
    });
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
 * Fan out a detected series bundle into individual per-book requests.
 *
 * Enumerates the series' books, then calls createRequestForUser for each with
 * `bundleDecomposed: true` (preventing re-detection). Returns a `decomposed`
 * result when at least one book request was created, or null when the series
 * could not be enumerated / yielded no usable books (caller falls back to
 * normal single-request handling).
 */
async function decomposeBundle(
  userId: string,
  bundle: CreateRequestInput,
  seriesAsin: string,
  range: [number, number] | undefined,
  options: CreateRequestOptions
): Promise<CreateRequestResult | null> {
  let books: CreateRequestInput[];
  try {
    books = await enumerateSeriesBooks(seriesAsin, range, bundle.asin);
  } catch (error) {
    logger.warn(`Failed to enumerate series ${seriesAsin} for bundle "${bundle.title}"`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  if (books.length === 0) return null;

  logger.info(`Decomposing bundle "${bundle.title}" into ${books.length} book request(s)`, {
    seriesAsin,
    range: range ? `${range[0]}-${range[1]}` : 'all',
  });

  const created: { asin: string; title: string }[] = [];
  for (const book of books) {
    try {
      const result = await createRequestForUser(userId, book, {
        ...options,
        bundleDecomposed: true,
      });
      if (result.success) {
        created.push({ asin: book.asin, title: book.title });
      }
    } catch (error) {
      logger.warn(`Failed to create request for "${book.title}" while decomposing "${bundle.title}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (created.length === 0) {
    // Every book was a duplicate/already-owned/failed — nothing new requested.
    // Still return a `decomposed` result (not null) so the caller reports the
    // bundle was handled and does NOT also create the bundle as a single request.
    return {
      success: true,
      decomposed: true,
      count: 0,
      books: [],
      message: `"${bundle.title}" is a series bundle, but all of its books were already requested or available`,
    };
  }

  return {
    success: true,
    decomposed: true,
    count: created.length,
    books: created,
    message: `"${bundle.title}" is a ${books.length}-book series — created ${created.length} individual request${created.length === 1 ? '' : 's'}`,
  };
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
