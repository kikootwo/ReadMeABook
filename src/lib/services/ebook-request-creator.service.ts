/**
 * Component: Ebook Request Creator Service
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Shared logic for creating an e-book request for an audiobook the user already owns (e-books are
 * a sidecar to an available audiobook). Extracted from the fetch-ebook API route so both the Web
 * UI and the Discord /request ebook flow run an identical code path, including the approval gate.
 */

import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('Service.EbookRequestCreator');

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

export type CreateEbookRequestResult =
  | { success: true; requestId: string; needsApproval: boolean; message: string }
  | {
      success: false;
      reason:
        | 'feature_disabled'
        | 'not_found_on_audible'
        | 'not_available'
        | 'already_active'
        | 'user_not_found'
        | 'error';
      message: string;
      requestId?: string;
    };

/**
 * Create (or retry) an e-book request for the given ASIN on behalf of a user.
 * Mirrors POST /api/audiobooks/[asin]/fetch-ebook exactly.
 */
export async function createEbookRequestForUser(
  userId: string,
  asin: string
): Promise<CreateEbookRequestResult> {
  try {
    // Check which ebook sources are enabled
    const [annasArchiveConfig, indexerSearchConfig, legacyConfig] = await Promise.all([
      prisma.configuration.findUnique({ where: { key: 'ebook_annas_archive_enabled' } }),
      prisma.configuration.findUnique({ where: { key: 'ebook_indexer_search_enabled' } }),
      prisma.configuration.findUnique({ where: { key: 'ebook_sidecar_enabled' } }),
    ]);

    const isAnnasArchiveEnabled =
      annasArchiveConfig?.value === 'true' ||
      (annasArchiveConfig === null && legacyConfig?.value === 'true');
    const isIndexerSearchEnabled = indexerSearchConfig?.value === 'true';

    if (!isAnnasArchiveEnabled && !isIndexerSearchEnabled) {
      return {
        success: false,
        reason: 'feature_disabled',
        message: 'E-book feature is not enabled (no sources configured)',
      };
    }

    // Fetch Audible metadata
    const audibleService = getAudibleService();
    let audibleData = null;
    try {
      audibleData = await audibleService.getAudiobookDetails(asin);
    } catch (error) {
      logger.warn(`Failed to fetch Audible data for ASIN ${asin}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    if (!audibleData) {
      return { success: false, reason: 'not_found_on_audible', message: 'Audiobook not found on Audible' };
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

    // Check for available audiobook request if audiobook exists in database
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
      return {
        success: false,
        reason: 'not_available',
        message: 'Audiobook must be available in your library before requesting an ebook',
      };
    }

    // If audiobook doesn't exist in database but is in Plex, create it
    if (!audiobook) {
      logger.info(`Creating audiobook record for "${audibleData.title}" (imported outside RMAB)`);

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
          status: 'available',
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

    const jobQueue = getJobQueueService();

    if (existingEbookRequest) {
      // Block if already active
      if (ACTIVE_EBOOK_STATUSES.includes(existingEbookRequest.status)) {
        return {
          success: false,
          reason: 'already_active',
          message: `E-book request already exists (status: ${existingEbookRequest.status})`,
          requestId: existingEbookRequest.id,
        };
      }

      // Retry if retryable
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

        await jobQueue.addSearchEbookJob(existingEbookRequest.id, {
          id: audiobook.id,
          title: audiobook.title,
          author: audiobook.author,
          asin: audiobook.audibleAsin || undefined,
        });

        logger.info(`Retrying ebook request ${existingEbookRequest.id} for "${audiobook.title}"`);

        return {
          success: true,
          requestId: existingEbookRequest.id,
          needsApproval: false,
          message: 'E-book search retried',
        };
      }
    }

    // Determine approval requirement
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        autoApproveRequests: true,
        plexUsername: true,
      },
    });

    if (!user) {
      return { success: false, reason: 'user_not_found', message: 'User not found' };
    }

    let needsApproval = false;
    if (user.role === 'admin') {
      needsApproval = false;
    } else if (user.autoApproveRequests === true) {
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

    if (needsApproval) {
      const ebookRequest = await prisma.request.create({
        data: {
          userId,
          audiobookId: audiobook.id,
          type: 'ebook',
          parentRequestId: availableRequest?.id || null,
          status: 'awaiting_approval',
          progress: 0,
          customSearchTerms: availableRequest?.customSearchTerms || null,
        },
      });

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

      return {
        success: true,
        requestId: ebookRequest.id,
        needsApproval: true,
        message: 'Ebook request submitted for admin approval',
      };
    }

    // Auto-approved
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

    await jobQueue.addSearchEbookJob(ebookRequest.id, {
      id: audiobook.id,
      title: audiobook.title,
      author: audiobook.author,
      asin: audiobook.audibleAsin || undefined,
    });

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

    return {
      success: true,
      requestId: ebookRequest.id,
      needsApproval: false,
      message: 'E-book request created and search started',
    };
  } catch (error) {
    logger.error('Failed to create ebook request', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { success: false, reason: 'error', message: error instanceof Error ? error.message : 'Internal server error' };
  }
}
