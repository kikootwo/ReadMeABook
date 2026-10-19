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
import { RMABLogger } from '@/lib/utils/logger';
import { startAnnasArchiveDownload, startIndexerEbookDownload, type SelectedEbook } from '@/lib/services/ebook-selection.service';
import { guardEbookSelection, selectionFailureResponse } from '@/lib/services/download-selection-guard';

const logger = RMABLogger.create('API.SelectEbook');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id: parentRequestId } = await params;
        const body = await request.json();
        let selectedEbook = body.ebook as SelectedEbook;

        if (!selectedEbook) {
          return NextResponse.json({ error: 'No ebook selected' }, { status: 400 });
        }

        if (!selectedEbook.source) {
          return NextResponse.json({ error: 'Ebook source not specified' }, { status: 400 });
        }

        // Indexer picks must be Prowlarr/magnet links; Anna's Archive links are rebuilt from the md5
        const ebookCheck = await guardEbookSelection(selectedEbook);
        if (!ebookCheck.ok) return selectionFailureResponse(ebookCheck);
        selectedEbook = ebookCheck.value;

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

        if (ebookRequest && !['failed', 'awaiting_search', 'pending'].includes(ebookRequest.status)) {
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
          await startAnnasArchiveDownload(
            ebookRequest.id,
            audiobook,
            selectedEbook,
            jobQueue
          );
        } else {
          // Indexer: Torrent/NZB download
          await startIndexerEbookDownload(
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
