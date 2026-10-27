/**
 * Component: Select Ebook API
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Applies a user-selected ebook source (Anna's Archive or indexer) to a request:
 * an ebook request directly, or an audiobook request's ebook (created if missing).
 * Admin for any request; a user only for their own ebook request, following the approval settings.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@/generated/prisma/client';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { RMABLogger } from '@/lib/utils/logger';
import { startAnnasArchiveDownload, startIndexerEbookDownload, type SelectedEbook } from '@/lib/services/ebook-selection.service';
import { guardEbookSelection, selectionFailureResponse } from '@/lib/services/download-selection-guard';
import { denyWithoutInteractiveSearchAccess } from '@/lib/middleware/interactive-search-access';
import { resolveAutoApprove } from '@/lib/utils/permissions';
import { readJsonBody } from '@/lib/utils/request-body';

const logger = RMABLogger.create('API.SelectEbook');

/** Ebook request statuses a new pick may restart */
const REUSABLE_EBOOK_STATUSES = ['failed', 'awaiting_search', 'pending'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json({ error: 'Unauthorized', message: 'User not authenticated' }, { status: 401 });
      }

      const accessDenied = await denyWithoutInteractiveSearchAccess(req.user.id);
      if (accessDenied) return accessDenied;

      const { id: requestId } = await params;
      const bodyResult = await readJsonBody(request);
      if (!bodyResult.ok) return bodyResult.response;
      const body = bodyResult.data;
      let selectedEbook = body.ebook as SelectedEbook;

      if (!selectedEbook) {
        return NextResponse.json({ error: 'No ebook selected' }, { status: 400 });
      }

      if (!selectedEbook.source) {
        return NextResponse.json({ error: 'Ebook source not specified' }, { status: 400 });
      }

      // Get the request - could be an audiobook request or an existing ebook request.
      // A deleted request answers 404 for everyone.
      const foundRequest = await prisma.request.findFirst({
        where: { id: requestId, deletedAt: null },
        include: { audiobook: true },
      });

      if (!foundRequest) {
        return NextResponse.json({ error: 'Request not found' }, { status: 404 });
      }

      const isAdmin = req.user.role === 'admin';
      if (foundRequest.userId !== req.user.id && !isAdmin) {
        return NextResponse.json(
          { error: 'Forbidden', message: 'You do not have access to this request' },
          { status: 403 }
        );
      }

      // My Requests only sends a non-admin's own ebook request here
      if (!isAdmin && foundRequest.type !== 'ebook') {
        return NextResponse.json(
          { error: 'Forbidden', message: 'Only an admin can pick an ebook for an audiobook request' },
          { status: 403 }
        );
      }

      // Indexer picks must be Prowlarr/magnet links; Anna's Archive links are rebuilt from the md5
      const ebookCheck = await guardEbookSelection(selectedEbook);
      if (!ebookCheck.ok) return selectionFailureResponse(ebookCheck);
      selectedEbook = ebookCheck.value;

      // The audiobook request the ebook belongs to. An ebook request created for a book
      // that was already in the library (no RMAB audiobook request) has none.
      let parentRequest: typeof foundRequest | null = null;
      if (foundRequest.type === 'ebook') {
        if (foundRequest.parentRequestId) {
          parentRequest = await prisma.request.findFirst({
            where: { id: foundRequest.parentRequestId, deletedAt: null },
            include: { audiobook: true },
          });
          if (!parentRequest) {
            return NextResponse.json({ error: 'Parent audiobook request not found' }, { status: 404 });
          }
        }
      } else if (foundRequest.type === 'audiobook') {
        parentRequest = foundRequest;
      } else {
        return NextResponse.json({ error: 'Can only select ebooks for audiobook requests' }, { status: 400 });
      }

      if (parentRequest && !['downloaded', 'available'].includes(parentRequest.status)) {
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
              parentRequestId: foundRequest.id,
              type: 'ebook',
              deletedAt: null,
            },
          });

      if (ebookRequest && !REUSABLE_EBOOK_STATUSES.includes(ebookRequest.status)) {
        return NextResponse.json({
          error: `E-book request already exists (status: ${ebookRequest.status})`,
          existingRequestId: ebookRequest.id,
        }, { status: 400 });
      }

      // Admins always skip approval; users follow their own setting, then the global one
      let needsApproval = false;
      let requesterName = 'Unknown User';
      if (!isAdmin) {
        const user = await prisma.user.findUnique({
          where: { id: req.user.id },
          select: { role: true, autoApproveRequests: true, plexUsername: true },
        });
        if (!user) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        needsApproval = !(await resolveAutoApprove(user.role, user.autoApproveRequests));
        requesterName = user.plexUsername || 'Unknown User';
      }

      // Waiting for approval: the pick is stored on the request for the admin's approve
      const status = needsApproval ? 'awaiting_approval' : 'searching';
      const pickData = needsApproval ? { selectedTorrent: selectedEbook as unknown as Prisma.InputJsonValue } : {};

      // Create or update ebook request
      if (ebookRequest) {
        // Reset existing failed/pending request
        ebookRequest = await prisma.request.update({
          where: { id: ebookRequest.id },
          data: {
            status,
            progress: 0,
            errorMessage: null,
            ...pickData,
            updatedAt: new Date(),
          },
        });
        logger.info(`Reusing existing ebook request ${ebookRequest.id} (${status})`);
      } else {
        // Only reached for an audiobook request with no ebook request yet
        const parent = parentRequest ?? foundRequest;
        ebookRequest = await prisma.request.create({
          data: {
            userId: parent.userId,
            audiobookId: parent.audiobookId,
            type: 'ebook',
            parentRequestId: parent.id,
            status,
            progress: 0,
            ...pickData,
            customSearchTerms: parent.customSearchTerms,
          },
        });
        logger.info(`Created new ebook request ${ebookRequest.id} (${status})`);
      }

      const audiobook = parentRequest?.audiobook ?? foundRequest.audiobook;
      const jobQueue = getJobQueueService();

      if (needsApproval) {
        await jobQueue.addNotificationJob(
          'request_pending_approval',
          ebookRequest.id,
          `${audiobook.title} (Ebook)`,
          audiobook.author,
          requesterName
        ).catch((error) => {
          logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
        });

        return NextResponse.json({
          success: true,
          message: 'Ebook request submitted for admin approval',
          requestId: ebookRequest.id,
          needsApproval: true,
        });
      }

      // Route to appropriate download based on source
      if (selectedEbook.source === 'annas_archive') {
        // Anna's Archive: Direct HTTP download
        await startAnnasArchiveDownload(ebookRequest.id, audiobook, selectedEbook, jobQueue);
      } else {
        // Indexer: Torrent/NZB download
        await startIndexerEbookDownload(ebookRequest.id, audiobook, selectedEbook, jobQueue);
      }

      // A user's pick that skipped approval is announced like any auto-approved request
      if (!isAdmin) {
        await jobQueue.addNotificationJob(
          'request_approved',
          ebookRequest.id,
          `${audiobook.title} (Ebook)`,
          audiobook.author,
          requesterName
        ).catch((error) => {
          logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
        });
      }

      return NextResponse.json({
        success: true,
        message: `E-book download started from ${selectedEbook.source === 'annas_archive' ? "Anna's Archive" : selectedEbook.indexer}`,
        requestId: ebookRequest.id,
        needsApproval: false,
      });
    } catch (error) {
      logger.error('Unexpected error', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      );
    }
  });
}
