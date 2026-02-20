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
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { RMABLogger } from '@/lib/utils/logger';

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
}

export type CreateRequestResult =
  | { success: true; request: any }
  | { success: false; reason: 'already_available' | 'being_processed' | 'duplicate' | 'user_not_found'; message: string };

/**
 * Create a request for a user, with full duplicate detection, library checks,
 * Audnexus enrichment, approval flow, notifications, and search job triggering.
 */
export async function createRequestForUser(
  userId: string,
  audiobook: CreateRequestInput,
  options: CreateRequestOptions = {}
): Promise<CreateRequestResult> {
  const { skipAutoSearch = false } = options;

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

  // Fetch full details from Audnexus for year/series
  let year: number | undefined;
  let series: string | undefined;
  let seriesPart: string | undefined;
  let seriesAsin: string | undefined;
  try {
    const audibleService = getAudibleService();
    const audnexusData = await audibleService.getAudiobookDetails(audiobook.asin);

    if (audnexusData?.releaseDate) {
      try {
        const releaseYear = new Date(audnexusData.releaseDate).getFullYear();
        if (!isNaN(releaseYear)) {
          year = releaseYear;
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

  let initialStatus: string;
  if (needsApproval) {
    initialStatus = 'awaiting_approval';
    shouldTriggerSearch = false;
  } else if (skipAutoSearch) {
    initialStatus = 'awaiting_search';
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
    },
    include: {
      audiobook: true,
      user: { select: { id: true, plexUsername: true } },
    },
  });

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
