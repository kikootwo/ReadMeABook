/**
 * Component: Select Ebook by ASIN API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Creates an ebook request with a user-selected source (Anna's Archive or indexer)
 * Routes to appropriate download processor based on source type
 * Includes approval logic for non-admin users
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { RMABLogger } from '@/lib/utils/logger';
import { startAnnasArchiveDownload, startIndexerEbookDownload, type SelectedEbook } from '@/lib/services/ebook-selection.service';
import { denyWithoutInteractiveSearchAccess } from '@/lib/middleware/interactive-search-access';
import { guardEbookSelection, selectionFailureResponse } from '@/lib/services/download-selection-guard';

const logger = RMABLogger.create('API.Audiobooks.SelectEbook');

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

// Statuses that allow reuse
const REUSABLE_STATUSES = ['failed', 'awaiting_search', 'pending'];

/**
 * POST /api/audiobooks/[asin]/select-ebook
 * Select and download an ebook from interactive search results
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ asin: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      const { asin } = await params;
      const body = await request.json();
      let selectedEbook = body.ebook as SelectedEbook;

      if (!asin || asin.length !== 10) {
        return NextResponse.json(
          { error: 'Valid ASIN is required' },
          { status: 400 }
        );
      }

      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }

      if (!selectedEbook) {
        return NextResponse.json({ error: 'No ebook selected' }, { status: 400 });
      }

      if (!selectedEbook.source) {
        return NextResponse.json({ error: 'Ebook source not specified' }, { status: 400 });
      }

      const accessDenied = await denyWithoutInteractiveSearchAccess(req.user.id);
      if (accessDenied) return accessDenied;

      // Indexer picks must be Prowlarr/magnet links; Anna's Archive links are rebuilt from the md5
      const ebookCheck = await guardEbookSelection(selectedEbook);
      if (!ebookCheck.ok) return selectionFailureResponse(ebookCheck);
      selectedEbook = ebookCheck.value;

      // First, fetch audiobook data from Audible (works for books imported outside RMAB)
      const audibleService = getAudibleService();
      let audibleData = null;
      try {
        audibleData = await audibleService.getAudiobookDetails(asin);
      } catch (error) {
        logger.warn(`Failed to fetch Audible data for ASIN ${asin}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      if (!audibleData) {
        return NextResponse.json(
          { error: 'Audiobook not found on Audible' },
          { status: 404 }
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
        return NextResponse.json(
          { error: 'Audiobook must be available in your library before requesting an ebook' },
          { status: 400 }
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
            status: 'available',
          },
        });
        logger.info(`Created audiobook ${audiobook.id} for "${audibleData.title}"`);
      }

      // Check for existing ebook request
      let ebookRequest = await prisma.request.findFirst({
        where: {
          audiobookId: audiobook.id,
          type: 'ebook',
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Handle existing ebook request
      if (ebookRequest) {
        if (ACTIVE_EBOOK_STATUSES.includes(ebookRequest.status) &&
            !REUSABLE_STATUSES.includes(ebookRequest.status)) {
          return NextResponse.json({
            error: `E-book request already exists (status: ${ebookRequest.status})`,
            existingRequestId: ebookRequest.id,
          }, { status: 400 });
        }
      }

      // Check if approval is needed for non-admin users
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          role: true,
          autoApproveRequests: true,
          plexUsername: true,
        },
      });

      if (!user) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
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
          const globalConfig = await prisma.configuration.findUnique({
            where: { key: 'auto_approve_requests' },
          });
          const globalAutoApprove = globalConfig === null ? true : globalConfig.value === 'true';
          needsApproval = !globalAutoApprove;
        }
      }

      const jobQueue = getJobQueueService();

      if (needsApproval) {
        // Create or update ebook request with awaiting_approval status
        if (ebookRequest && REUSABLE_STATUSES.includes(ebookRequest.status)) {
          ebookRequest = await prisma.request.update({
            where: { id: ebookRequest.id },
            data: {
              status: 'awaiting_approval',
              progress: 0,
              errorMessage: null,
              selectedTorrent: selectedEbook as any, // Store selected ebook for later
              updatedAt: new Date(),
            },
          });
          logger.info(`Reusing ebook request ${ebookRequest.id}, awaiting approval`);
        } else {
          ebookRequest = await prisma.request.create({
            data: {
              userId: req.user.id,
              audiobookId: audiobook.id,
              type: 'ebook',
              parentRequestId: availableRequest?.id || null,
              status: 'awaiting_approval',
              progress: 0,
              selectedTorrent: selectedEbook as any,
              customSearchTerms: availableRequest?.customSearchTerms || null,
            },
          });
          logger.info(`Created ebook request ${ebookRequest.id}, awaiting approval`);
        }

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

        return NextResponse.json({
          success: true,
          message: 'Ebook request submitted for admin approval',
          requestId: ebookRequest.id,
          needsApproval: true,
        }, { status: 201 });
      } else {
        // Auto-approved - create or update request and start download
        if (ebookRequest && REUSABLE_STATUSES.includes(ebookRequest.status)) {
          ebookRequest = await prisma.request.update({
            where: { id: ebookRequest.id },
            data: {
              status: 'searching',
              progress: 0,
              errorMessage: null,
              updatedAt: new Date(),
            },
          });
          logger.info(`Reusing existing ebook request ${ebookRequest.id}`);
        } else {
          ebookRequest = await prisma.request.create({
            data: {
              userId: req.user.id,
              audiobookId: audiobook.id,
              type: 'ebook',
              parentRequestId: availableRequest?.id || null,
              status: 'searching',
              progress: 0,
              customSearchTerms: availableRequest?.customSearchTerms || null,
            },
          });
          logger.info(`Created new ebook request ${ebookRequest.id}`);
        }

        // Route to appropriate download based on source
        if (selectedEbook.source === 'annas_archive') {
          await startAnnasArchiveDownload(
            ebookRequest.id,
            audiobook,
            selectedEbook,
            jobQueue
          );
        } else {
          await startIndexerEbookDownload(
            ebookRequest.id,
            audiobook,
            selectedEbook,
            jobQueue
          );
        }

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

        return NextResponse.json({
          success: true,
          message: `E-book download started from ${selectedEbook.source === 'annas_archive' ? "Anna's Archive" : selectedEbook.indexer}`,
          requestId: ebookRequest.id,
          needsApproval: false,
        });
      }
    } catch (error) {
      logger.error('Unexpected error', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
