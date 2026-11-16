/**
 * Component: Ebook Request Creator (shared by the fetch-ebook route and the Discord bot)
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Creates an ebook request for an available audiobook (by ASIN)
 * Supports both audiobooks with parent requests and orphan audiobooks (imported outside RMAB)
 * Includes approval logic for non-admin users
 *
 * The caller authenticates and passes the RMAB user id (from the session, or from the Discord
 * actor resolver), never one taken from request input. Returns the HTTP status and body the
 * route answers with, plus an `outcome` other callers read instead of the body: the 500 body
 * carries the raw error text, which only the route may show.
 */

import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('EbookRequestCreator');

// Statuses that indicate an active/in-progress ebook request
const ACTIVE_EBOOK_STATUSES = [
  'pending',
  'awaiting_approval',
  'searching',
  'downloading',
  'processing',
  'downloaded',
  'available',
];

// Statuses that allow retry
const RETRYABLE_STATUSES = ['failed', 'awaiting_search'];

export type EbookRequestOutcome =
  | 'sources_disabled'
  | 'not_on_audible'
  | 'not_available'
  | 'already_requested'
  | 'retried'
  | 'user_not_found'
  | 'created'
  | 'error';

export interface EbookRequestResult {
  outcome: EbookRequestOutcome;
  /** The fetch-ebook route's HTTP status for this outcome. */
  status: number;
  /** The fetch-ebook route's JSON body. Route only: the `error` outcome's body holds the raw error text. */
  body: Record<string, unknown>;
  requestId?: string;
  /** Set on `created`: true when the request waits for an admin. */
  needsApproval?: boolean;
}

function result(
  outcome: EbookRequestOutcome,
  status: number,
  body: Record<string, unknown>,
  extra: Pick<EbookRequestResult, 'requestId' | 'needsApproval'> = {}
): EbookRequestResult {
  return { outcome, status, body, ...extra };
}

/** Create an ebook request for an available audiobook. Never throws. */
export async function createEbookRequestForUser(userId: string, asin: string): Promise<EbookRequestResult> {
  try {
    // Check which ebook sources are enabled
    const [annasArchiveConfig, indexerSearchConfig, legacyConfig] = await Promise.all([
      prisma.configuration.findUnique({ where: { key: 'ebook_annas_archive_enabled' } }),
      prisma.configuration.findUnique({ where: { key: 'ebook_indexer_search_enabled' } }),
      prisma.configuration.findUnique({ where: { key: 'ebook_sidecar_enabled' } }),
    ]);

    const isAnnasArchiveEnabled = annasArchiveConfig?.value === 'true' ||
      (annasArchiveConfig === null && legacyConfig?.value === 'true');
    const isIndexerSearchEnabled = indexerSearchConfig?.value === 'true';

    if (!isAnnasArchiveEnabled && !isIndexerSearchEnabled) {
      return result('sources_disabled',
        400,
        { error: 'E-book feature is not enabled (no sources configured)' },
      );
    }

    // First, check if the audiobook is available in Plex library
    // This works even for books imported outside RMAB
    const audibleService = getAudibleService();
    let audibleData = null;
    try {
      audibleData = await audibleService.getAudiobookDetails(asin);
    } catch (error) {
      logger.warn(`Failed to fetch Audible data for ASIN ${asin}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    if (!audibleData) {
      return result('not_on_audible',
        404,
        { error: 'Audiobook not found on Audible' },
      );
    }

    // Check Plex availability using Audible metadata
    const plexMatch = await findPlexMatch({
      asin,
      title: audibleData.title,
      author: audibleData.author,
    });

    // Find or create audiobook record
    let audiobook = await prisma.audiobook.findFirst({
      where: { audibleAsin: asin },
    });

    // Check for available request if audiobook exists in database
    let availableRequest = null;
    if (audiobook) {
      availableRequest = await prisma.request.findFirst({
        where: {
          audiobookId: audiobook.id,
          type: 'audiobook',
          status: { in: ['downloaded', 'available'] },
          deletedAt: null,
        },
      });
    }

    const isAvailable = !!availableRequest || !!plexMatch;

    if (!isAvailable) {
      return result('not_available',
        400,
        { error: 'Audiobook must be available in your library before requesting an ebook' },
      );
    }

    // If audiobook doesn't exist in database but is in Plex, create it
    if (!audiobook) {
      logger.info(`Creating audiobook record for "${audibleData.title}" (imported outside RMAB)`);

      // Extract year from release date
      let year: number | undefined;
      if (audibleData.releaseDate) {
        try {
          const releaseYear = new Date(audibleData.releaseDate).getFullYear();
          if (!isNaN(releaseYear)) {
            year = releaseYear;
          }
        } catch {
          // Ignore parsing errors
        }
      }

      audiobook = await prisma.audiobook.create({
        data: {
          audibleAsin: asin,
          title: audibleData.title,
          author: audibleData.author,
          narrator: audibleData.narrator,
          description: audibleData.description,
          coverArtUrl: audibleData.coverArtUrl,
          year,
          series: audibleData.series,
          seriesPart: audibleData.seriesPart,
          status: 'available', // Mark as available since it's in Plex
        },
      });
      logger.info(`Created audiobook ${audiobook.id} for "${audibleData.title}"`);
    }

    // Check for existing ebook request for this audiobook
    const existingEbookRequest = await prisma.request.findFirst({
      where: {
        audiobookId: audiobook.id,
        type: 'ebook',
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Handle existing ebook request
    if (existingEbookRequest) {
      // If in active status, block
      if (ACTIVE_EBOOK_STATUSES.includes(existingEbookRequest.status)) {
        return result('already_requested', 409, {
          success: false,
          message: `E-book request already exists (status: ${existingEbookRequest.status})`,
          requestId: existingEbookRequest.id,
        }, { requestId: existingEbookRequest.id });
      }

      // If retryable, reset and retry
      if (RETRYABLE_STATUSES.includes(existingEbookRequest.status)) {
        await prisma.request.update({
          where: { id: existingEbookRequest.id },
          data: {
            status: 'pending',
            progress: 0,
            errorMessage: null,
            updatedAt: new Date(),
          },
        });

        const jobQueue = getJobQueueService();
        await jobQueue.addSearchEbookJob(existingEbookRequest.id, {
          id: audiobook.id,
          title: audiobook.title,
          author: audiobook.author,
          asin: audiobook.audibleAsin || undefined,
        });

        logger.info(`Retrying ebook request ${existingEbookRequest.id} for "${audiobook.title}"`);

        return result('retried', 200, {
          success: true,
          message: 'E-book search retried',
          requestId: existingEbookRequest.id,
        }, { requestId: existingEbookRequest.id });
      }
    }

    // Check if approval is needed for non-admin users
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        autoApproveRequests: true,
        plexUsername: true,
      },
    });

    if (!user) {
      return result('user_not_found',
        404,
        { error: 'User not found' },
      );
    }

    let needsApproval = false;

    if (user.role === 'admin') {
      needsApproval = false;
    } else {
      if (user.autoApproveRequests === true) {
        needsApproval = false;
      } else if (user.autoApproveRequests === false) {
        needsApproval = true;
      } else {
        // User setting is null, check global setting
        const globalConfig = await prisma.configuration.findUnique({
          where: { key: 'auto_approve_requests' },
        });
        // Default to true if not configured (backward compatibility)
        const globalAutoApprove = globalConfig === null ? true : globalConfig.value === 'true';
        needsApproval = !globalAutoApprove;
      }
    }

    const jobQueue = getJobQueueService();

    if (needsApproval) {
      // Create ebook request with awaiting_approval status
      const ebookRequest = await prisma.request.create({
        data: {
          userId,
          audiobookId: audiobook.id,
          type: 'ebook',
          parentRequestId: availableRequest?.id || null, // Link to parent if exists
          status: 'awaiting_approval',
          progress: 0,
          customSearchTerms: availableRequest?.customSearchTerms || null,
        },
      });

      // Send pending approval notification
      await jobQueue.addNotificationJob(
        'request_pending_approval',
        ebookRequest.id,
        `${audiobook.title} (Ebook)`,
        audiobook.author,
        user.plexUsername || 'Unknown User'
      ).catch((error) => {
        logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
      });

      logger.info(`Ebook request ${ebookRequest.id} created, awaiting admin approval`);

      return result('created', 201, {
        success: true,
        message: 'Ebook request submitted for admin approval',
        requestId: ebookRequest.id,
        needsApproval: true,
      }, { requestId: ebookRequest.id, needsApproval: true });
    } else {
      // Auto-approved - create request and start search
      const ebookRequest = await prisma.request.create({
        data: {
          userId,
          audiobookId: audiobook.id,
          type: 'ebook',
          parentRequestId: availableRequest?.id || null,
          status: 'pending',
          progress: 0,
          customSearchTerms: availableRequest?.customSearchTerms || null,
        },
      });

      logger.info(`Created ebook request ${ebookRequest.id} for "${audiobook.title}"`);

      // Trigger ebook search job
      await jobQueue.addSearchEbookJob(ebookRequest.id, {
        id: audiobook.id,
        title: audiobook.title,
        author: audiobook.author,
        asin: audiobook.audibleAsin || undefined,
      });

      // Send approved notification
      await jobQueue.addNotificationJob(
        'request_approved',
        ebookRequest.id,
        `${audiobook.title} (Ebook)`,
        audiobook.author,
        user.plexUsername || 'Unknown User'
      ).catch((error) => {
        logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
      });

      logger.info(`Triggered search_ebook job for request ${ebookRequest.id}`);

      return result('created', 201, {
        success: true,
        message: 'E-book request created and search started',
        requestId: ebookRequest.id,
        needsApproval: false,
      }, { requestId: ebookRequest.id, needsApproval: false });
    }
  } catch (error) {
    logger.error('Unexpected error', { error: error instanceof Error ? error.message : String(error) });
    return result('error',
      500,
      { error: error instanceof Error ? error.message : 'Internal server error' },
    );
  }
}
