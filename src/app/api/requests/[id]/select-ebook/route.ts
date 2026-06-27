/**
 * Component: Select Ebook API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Creates an ebook request with a user-selected source (Anna's Archive or indexer)
 * Routes to appropriate download processor based on source type
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';
import { getSlowDownloadLinks } from '@/lib/services/ebook-scraper';

const logger = RMABLogger.create('API.SelectEbook');

interface SelectedEbook {
  guid: string;
  title: string;
  size: number;
  seeders: number;
  indexer: string;
  indexerId?: number;
  downloadUrl: string;
  infoUrl?: string;
  score: number;
  finalScore: number;
  source: 'annas_archive' | 'prowlarr';
  format?: string;
  md5?: string;
  downloadUrls?: string[];
  protocol?: string; // 'torrent' or 'usenet' - determines download client
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id: parentRequestId } = await params;
        const body = await request.json();
        const selectedEbook = body.ebook as SelectedEbook;

        if (!selectedEbook) {
          return NextResponse.json({ error: 'No ebook selected' }, { status: 400 });
        }

        if (!selectedEbook.source) {
          return NextResponse.json({ error: 'Ebook source not specified' }, { status: 400 });
        }

        // Get the request - could be an audiobook request or an existing ebook request
        const foundRequest = await prisma.request.findUnique({
          where: { id: parentRequestId },
          include: { audiobook: true },
        });

        if (!foundRequest) {
          return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }

        // If this is an ebook request, find the parent audiobook request
        let parentRequest;
        if (foundRequest.type === 'ebook') {
          if (!foundRequest.parentRequestId) {
            return NextResponse.json({ error: 'Ebook request has no parent audiobook request' }, { status: 400 });
          }
          parentRequest = await prisma.request.findUnique({
            where: { id: foundRequest.parentRequestId },
            include: { audiobook: true },
          });
          if (!parentRequest) {
            return NextResponse.json({ error: 'Parent audiobook request not found' }, { status: 404 });
          }
        } else if (foundRequest.type === 'audiobook') {
          parentRequest = foundRequest;
        } else {
          return NextResponse.json({ error: 'Can only select ebooks for audiobook requests' }, { status: 400 });
        }

        if (!['downloaded', 'available'].includes(parentRequest.status)) {
          return NextResponse.json(
            { error: `Cannot select ebook for request in ${parentRequest.status} status` },
            { status: 400 }
          );
        }

        // Check for existing ebook request
        // If we were given an ebook request ID directly, use that; otherwise search by parent
        let ebookRequest = foundRequest.type === 'ebook'
          ? foundRequest
          : await prisma.request.findFirst({
              where: {
                parentRequestId: parentRequest.id,
                type: 'ebook',
                deletedAt: null,
              },
            });

        if (ebookRequest && !['failed', 'awaiting_search', 'pending', 'unavailable'].includes(ebookRequest.status)) {
          return NextResponse.json({
            error: `E-book request already exists (status: ${ebookRequest.status})`,
            existingRequestId: ebookRequest.id,
          }, { status: 400 });
        }

        // Create or update ebook request
        if (ebookRequest) {
          // Reset existing failed/pending request
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
          // Create new ebook request
          ebookRequest = await prisma.request.create({
            data: {
              userId: parentRequest.userId,
              audiobookId: parentRequest.audiobookId,
              type: 'ebook',
              parentRequestId: parentRequest.id,
              status: 'searching',
              progress: 0,
              customSearchTerms: parentRequest.customSearchTerms,
            },
          });
          logger.info(`Created new ebook request ${ebookRequest.id}`);
        }

        const audiobook = parentRequest.audiobook;
        const jobQueue = getJobQueueService();

        // Route to appropriate download based on source
        if (selectedEbook.source === 'annas_archive') {
          // Anna's Archive: Direct HTTP download
          const aaResult = await handleAnnasArchiveDownload(
            ebookRequest.id,
            audiobook,
            selectedEbook,
            jobQueue
          );
          if (!aaResult.success) {
            // Revert request status so the user can retry from the modal
            await prisma.request.update({
              where: { id: ebookRequest.id },
              data: { status: 'awaiting_search', errorMessage: aaResult.error, updatedAt: new Date() },
            });
            return NextResponse.json(
              { error: aaResult.error, message: 'Download failed', success: false, requestId: ebookRequest.id },
              { status: 400 }
            );
          }
        } else {
          // Indexer: Torrent/NZB download
          await handleIndexerDownload(
            ebookRequest.id,
            audiobook,
            selectedEbook,
            jobQueue
          );
        }

        return NextResponse.json({
          success: true,
          message: `E-book download started from ${selectedEbook.source === 'annas_archive' ? "Anna's Archive" : selectedEbook.indexer}`,
          requestId: ebookRequest.id,
        });

      } catch (error) {
        logger.error('Unexpected error', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: error instanceof Error ? error.message : 'Internal server error' },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * Handle Anna's Archive download (direct HTTP)
 */
async function handleAnnasArchiveDownload(
  requestId: string,
  audiobook: { id: string; title: string; author: string },
  selectedEbook: SelectedEbook,
  jobQueue: ReturnType<typeof getJobQueueService>
) {
  const configService = getConfigService();
  const preferredFormat = await configService.get('ebook_sidecar_preferred_format') || 'epub';

  // Resolve download URLs on-demand when only md5 is provided (AA search modal flow)
  if ((!selectedEbook.downloadUrls || selectedEbook.downloadUrls.length === 0) && selectedEbook.md5) {
    const baseUrl = await configService.get('ebook_sidecar_base_url') || 'https://annas-archive.gl';
    const flaresolverrUrl = await configService.get('ebook_sidecar_flaresolverr_url');
    const slowLinks = await getSlowDownloadLinks(selectedEbook.md5, baseUrl, undefined, flaresolverrUrl || undefined);
    if (slowLinks.length === 0) {
      return { success: false as const, error: 'No download links available — FlareSolverr may be unavailable. Try again later.' };
    }
    selectedEbook.downloadUrls = slowLinks;
    selectedEbook.downloadUrl = slowLinks[0];
  }

  logger.info(`Starting Anna's Archive download for "${audiobook.title}"`);
  logger.info(`MD5: ${selectedEbook.md5}, Format: ${selectedEbook.format || preferredFormat}`);

  // Create download history record
  const downloadHistory = await prisma.downloadHistory.create({
    data: {
      requestId,
      indexerName: "Anna's Archive",
      torrentName: `${audiobook.title} - ${audiobook.author}.${selectedEbook.format || preferredFormat}`,
      torrentSizeBytes: null, // Unknown until download starts
      qualityScore: selectedEbook.score,
      selected: true,
      downloadClient: 'direct',
      downloadStatus: 'queued',
    },
  });

  // Store all download URLs for retry purposes
  if (selectedEbook.downloadUrls && selectedEbook.downloadUrls.length > 0) {
    await prisma.downloadHistory.update({
      where: { id: downloadHistory.id },
      data: {
        torrentUrl: JSON.stringify(selectedEbook.downloadUrls),
      },
    });
  }

  // Trigger direct download job
  await jobQueue.addStartDirectDownloadJob(
    requestId,
    downloadHistory.id,
    selectedEbook.downloadUrl,
    `${audiobook.title} - ${audiobook.author}.${selectedEbook.format || preferredFormat}`,
    undefined // Size unknown
  );

  logger.info(`Queued direct download job for request ${requestId}`);
  return { success: true as const };
}

/**
 * Handle indexer download (torrent/NZB)
 */
async function handleIndexerDownload(
  requestId: string,
  audiobook: { id: string; title: string; author: string },
  selectedEbook: SelectedEbook,
  jobQueue: ReturnType<typeof getJobQueueService>
) {
  logger.info(`Starting indexer download for "${audiobook.title}"`);
  logger.info(`Torrent: "${selectedEbook.title}", Indexer: ${selectedEbook.indexer}`);

  // Convert to RankedTorrent shape expected by download job
  // Note: format is omitted as ebook formats (epub, pdf) differ from audiobook formats (M4B, M4A, MP3)
  const torrentForJob = {
    guid: selectedEbook.guid,
    title: selectedEbook.title,
    size: selectedEbook.size,
    seeders: selectedEbook.seeders || 0,
    indexer: selectedEbook.indexer,
    indexerId: selectedEbook.indexerId,
    downloadUrl: selectedEbook.downloadUrl,
    infoUrl: selectedEbook.infoUrl,
    publishDate: new Date(),
    score: selectedEbook.score,
    finalScore: selectedEbook.finalScore,
    bonusPoints: 0,
    bonusModifiers: [],
    rank: 1,
    breakdown: {
      formatScore: 0,
      sizeScore: 0,
      seederScore: 0,
      matchScore: 0,
      totalScore: selectedEbook.score,
      notes: [],
    },
    protocol: selectedEbook.protocol, // Pass through protocol for torrent vs usenet routing
  };

  // Use the download job (same as audiobooks)
  await jobQueue.addDownloadJob(requestId, {
    id: audiobook.id,
    title: audiobook.title,
    author: audiobook.author,
  }, torrentForJob as any); // Cast to any since ebook torrents don't have audiobook format field

  logger.info(`Queued download job for request ${requestId}`);
}
