/**
 * Component: Fetch E-book API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Creates an ebook request for a completed audiobook request
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.FetchEbook');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { id: parentRequestId } = await params;

        // Check which ebook sources are enabled
        const [annasArchiveConfig, indexerSearchConfig, legacyConfig] = await Promise.all([
          prisma.configuration.findUnique({ where: { key: 'ebook_annas_archive_enabled' } }),
          prisma.configuration.findUnique({ where: { key: 'ebook_indexer_search_enabled' } }),
          prisma.configuration.findUnique({ where: { key: 'ebook_sidecar_enabled' } }),
        ]);

        // Legacy migration: check old key if new keys don't exist
        const isAnnasArchiveEnabled = annasArchiveConfig?.value === 'true' ||
          (annasArchiveConfig === null && legacyConfig?.value === 'true');
        const isIndexerSearchEnabled = indexerSearchConfig?.value === 'true';

        // If no sources are enabled, return error
        if (!isAnnasArchiveEnabled && !isIndexerSearchEnabled) {
          return NextResponse.json(
            { error: 'E-book sidecar feature is not enabled (no sources configured)' },
            { status: 400 }
          );
        }

        // Get the parent request with audiobook data
        const parentRequest = await prisma.request.findUnique({
          where: { id: parentRequestId },
          include: {
            audiobook: true,
          },
        });

        if (!parentRequest) {
          return NextResponse.json(
            { error: 'Request not found' },
            { status: 404 }
          );
        }

        // Check if parent request is in completed state
        if (!['downloaded', 'available'].includes(parentRequest.status)) {
          return NextResponse.json(
            { error: `Cannot fetch e-book for request in ${parentRequest.status} status` },
            { status: 400 }
          );
        }

        // Check if an ebook request already exists for this parent
        const existingEbookRequest = await prisma.request.findFirst({
          where: {
            parentRequestId,
            type: 'ebook',
            deletedAt: null,
          },
        });

        if (existingEbookRequest) {
          // Check status - if failed/pending, we can retry
          if (['failed', 'awaiting_search'].includes(existingEbookRequest.status)) {
            // Reset and retry
            await prisma.request.update({
              where: { id: existingEbookRequest.id },
              data: {
                status: 'pending',
                progress: 0,
                errorMessage: null,
                updatedAt: new Date(),
              },
            });

            // Trigger search job
            const jobQueue = getJobQueueService();
            await jobQueue.addSearchEbookJob(existingEbookRequest.id, {
              id: parentRequest.audiobook.id,
              title: parentRequest.audiobook.title,
              author: parentRequest.audiobook.author,
              asin: parentRequest.audiobook.audibleAsin || undefined,
            });

            logger.info(`Retrying ebook request ${existingEbookRequest.id} for "${parentRequest.audiobook.title}"`);

            return NextResponse.json({
              success: true,
              message: 'E-book search retried',
              requestId: existingEbookRequest.id,
            });
          }

          // Trigger 2 (#6): if already downloaded, deliver the existing copy to the request
          // owner's e-reader devices. Send job dedupes by device; ABS-only + feature-gated inside.
          if (existingEbookRequest.status === 'downloaded') {
            const jobQueue = getJobQueueService();
            await jobQueue.addSendToEreaderJob(
              existingEbookRequest.id,
              parentRequest.audiobook.id,
              parentRequest.audiobook.title,
              parentRequest.audiobook.author,
              [parentRequest.userId],
              0
            ).catch((error) => {
              logger.error('Failed to queue send-to-ereader job for late requester', { error: error instanceof Error ? error.message : String(error) });
            });
          }

          // Already exists and not in a retryable state
          return NextResponse.json({
            success: false,
            message: `E-book request already exists (status: ${existingEbookRequest.status})`,
            requestId: existingEbookRequest.id,
          });
        }

        // Create new ebook request
        const ebookRequest = await prisma.request.create({
          data: {
            userId: parentRequest.userId,
            audiobookId: parentRequest.audiobookId,
            type: 'ebook',
            parentRequestId,
            status: 'pending',
            progress: 0,
            customSearchTerms: parentRequest.customSearchTerms,
          },
        });

        logger.info(`Created ebook request ${ebookRequest.id} for "${parentRequest.audiobook.title}"`);

        // Trigger ebook search job
        const jobQueue = getJobQueueService();
        await jobQueue.addSearchEbookJob(ebookRequest.id, {
          id: parentRequest.audiobook.id,
          title: parentRequest.audiobook.title,
          author: parentRequest.audiobook.author,
          asin: parentRequest.audiobook.audibleAsin || undefined,
        });

        logger.info(`Triggered search_ebook job for request ${ebookRequest.id}`);

        return NextResponse.json({
          success: true,
          message: 'E-book request created and search started',
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
