/**
 * Component: Requests API Routes
 * Documentation: documentation/backend/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { getAudibleService } from '@/lib/integrations/audible.service';
import { z } from 'zod';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Requests');

const CreateRequestSchema = z.object({
  audiobook: z.object({
    asin: z.string(),
    title: z.string(),
    author: z.string(),
    narrator: z.string().optional(),
    description: z.string().optional(),
    coverArtUrl: z.string().optional(),
    durationMinutes: z.number().optional(),
    releaseDate: z.string().optional(),
    rating: z.number().nullable().optional(),
  }),
});

/**
 * POST /api/requests
 * Create a new audiobook request
 */
export async function POST(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const body = await req.json();
      const { audiobook } = CreateRequestSchema.parse(body);

      // First check: Is there an existing request in 'downloaded' or 'available' status?
      // This catches the gap where files are organized but Plex hasn't scanned yet
      const existingActiveRequest = await prisma.request.findFirst({
        where: {
          audiobook: {
            audibleAsin: audiobook.asin,
          },
          status: { in: ['downloaded', 'available'] },
          deletedAt: null,
        },
        include: {
          user: { select: { plexUsername: true } },
        },
      });

      if (existingActiveRequest) {
        const status = existingActiveRequest.status;
        const isOwnRequest = existingActiveRequest.userId === req.user.id;

        return NextResponse.json(
          {
            error: status === 'available' ? 'AlreadyAvailable' : 'BeingProcessed',
            message: status === 'available'
              ? 'This audiobook is already available in your Plex library'
              : 'This audiobook is being processed and will be available soon',
            requestStatus: status,
            isOwnRequest,
            requestedBy: existingActiveRequest.user?.plexUsername,
          },
          { status: 409 }
        );
      }

      // Second check: Is audiobook already in Plex library? (fallback for non-requested books)
      const plexMatch = await findPlexMatch({
        asin: audiobook.asin,
        title: audiobook.title,
        author: audiobook.author,
        narrator: audiobook.narrator,
      });

      if (plexMatch) {
        return NextResponse.json(
          {
            error: 'AlreadyAvailable',
            message: 'This audiobook is already available in your Plex library',
            plexGuid: plexMatch.plexGuid,
          },
          { status: 409 }
        );
      }

      // Fetch full details from Audnexus to get releaseDate, year, and series
      let year: number | undefined;
      let series: string | undefined;
      let seriesPart: string | undefined;
      try {
        const audibleService = getAudibleService();
        const audnexusData = await audibleService.getAudiobookDetails(audiobook.asin);

        if (audnexusData?.releaseDate) {
          try {
            const releaseYear = new Date(audnexusData.releaseDate).getFullYear();
            if (!isNaN(releaseYear)) {
              year = releaseYear;
              logger.debug(`Extracted year ${year} from Audnexus releaseDate: ${audnexusData.releaseDate}`);
            }
          } catch (error) {
            logger.warn(`Failed to parse Audnexus releaseDate "${audnexusData.releaseDate}": ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        // Extract series data
        if (audnexusData?.series) {
          series = audnexusData.series;
          logger.debug(`Extracted series: ${series}`);
        }
        if (audnexusData?.seriesPart) {
          seriesPart = audnexusData.seriesPart;
          logger.debug(`Extracted seriesPart: ${seriesPart}`);
        }
      } catch (error) {
        logger.warn(`Failed to fetch Audnexus data for ASIN ${audiobook.asin}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Try to find existing audiobook record by ASIN
      let audiobookRecord = await prisma.audiobook.findFirst({
        where: { audibleAsin: audiobook.asin },
      });

      // If not found, create new audiobook record
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
            status: 'requested',
          },
        });
        logger.debug(`Created audiobook ${audiobookRecord.id} with year: ${year || 'none'}, series: ${series || 'none'}`);
      } else if (year || series || seriesPart) {
        // Always update year/series if we have them from Audnexus (even if audiobook already has them)
        audiobookRecord = await prisma.audiobook.update({
          where: { id: audiobookRecord.id },
          data: {
            ...(year && { year }),
            ...(series && { series }),
            ...(seriesPart && { seriesPart }),
          },
        });
        logger.debug(`Updated audiobook ${audiobookRecord.id} with year: ${year || 'unchanged'}, series: ${series || 'unchanged'}`);
      }

      // Check if user already has an active (non-deleted) request for this audiobook
      const existingRequest = await prisma.request.findFirst({
        where: {
          userId: req.user.id,
          audiobookId: audiobookRecord.id,
          deletedAt: null, // Only check active requests
        },
      });

      if (existingRequest) {
        // Allow re-requesting if the status is failed, warn, or cancelled
        const canReRequest = ['failed', 'warn', 'cancelled'].includes(existingRequest.status);

        if (!canReRequest) {
          return NextResponse.json(
            {
              error: 'DuplicateRequest',
              message: 'You have already requested this audiobook',
              request: existingRequest,
            },
            { status: 409 }
          );
        }

        // Delete the existing failed/warn/cancelled request
        logger.debug(`Deleting existing ${existingRequest.status} request ${existingRequest.id} to allow re-request`);
        await prisma.request.delete({
          where: { id: existingRequest.id },
        });
      }

      // Check if we should skip auto-search (for interactive search)
      const skipAutoSearch = req.nextUrl.searchParams.get('skipAutoSearch') === 'true';

      // Check if request needs approval
      let needsApproval = false;
      let shouldTriggerSearch = !skipAutoSearch;

      // Fetch user with autoApproveRequests setting
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          role: true,
          autoApproveRequests: true,
        },
      });

      if (!user) {
        return NextResponse.json(
          { error: 'UserNotFound', message: 'User not found' },
          { status: 404 }
        );
      }

      // Determine if approval is needed
      if (user.role === 'admin') {
        // Admins always auto-approve
        needsApproval = false;
      } else {
        // Check user's personal setting first
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

      // Determine initial status
      let initialStatus: string;
      if (needsApproval) {
        initialStatus = 'awaiting_approval';
        shouldTriggerSearch = false; // Don't trigger search if awaiting approval
      } else if (skipAutoSearch) {
        initialStatus = 'awaiting_search';
      } else {
        initialStatus = 'pending';
      }

      // Create request with appropriate status
      const newRequest = await prisma.request.create({
        data: {
          userId: req.user.id,
          audiobookId: audiobookRecord.id,
          status: initialStatus,
          progress: 0,
        },
        include: {
          audiobook: true,
          user: {
            select: {
              id: true,
              plexUsername: true,
            },
          },
        },
      });

      const jobQueue = getJobQueueService();

      // Send notification based on approval status
      if (initialStatus === 'awaiting_approval') {
        // Request needs approval - send pending notification
        await jobQueue.addNotificationJob(
          'request_pending_approval',
          newRequest.id,
          audiobookRecord.title,
          audiobookRecord.author,
          newRequest.user.plexUsername || 'Unknown User'
        ).catch((error) => {
          logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
        });
      } else {
        // Request was auto-approved (either automatic or interactive search) - send approved notification
        await jobQueue.addNotificationJob(
          'request_approved',
          newRequest.id,
          audiobookRecord.title,
          audiobookRecord.author,
          newRequest.user.plexUsername || 'Unknown User'
        ).catch((error) => {
          logger.error('Failed to queue notification', { error: error instanceof Error ? error.message : String(error) });
        });
      }

      // Trigger search job only if not skipped and not awaiting approval
      if (shouldTriggerSearch) {
        await jobQueue.addSearchJob(newRequest.id, {
          id: audiobookRecord.id,
          title: audiobookRecord.title,
          author: audiobookRecord.author,
          asin: audiobookRecord.audibleAsin || undefined,
        });
      }

      return NextResponse.json({
        success: true,
        request: newRequest,
      }, { status: 201 });
    } catch (error) {
      logger.error('Failed to create request', { error: error instanceof Error ? error.message : String(error) });

      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            error: 'ValidationError',
            details: error.errors,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          error: 'RequestError',
          message: 'Failed to create audiobook request',
        },
        { status: 500 }
      );
    }
  });
}

/**
 * GET /api/requests?status=pending&limit=50
 * Get user's audiobook requests (or all requests for admins)
 */
export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    try {
      if (!req.user) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'User not authenticated' },
          { status: 401 }
        );
      }

      const searchParams = req.nextUrl.searchParams;
      const status = searchParams.get('status');
      const limit = parseInt(searchParams.get('limit') || '50', 10);
      const myOnly = searchParams.get('myOnly') === 'true';
      const isAdmin = req.user.role === 'admin';

      // Build query
      // If myOnly=true, always filter by current user (even for admins)
      // Otherwise, admins see all requests, users see only their own
      const where: any = myOnly || !isAdmin ? { userId: req.user.id } : {};
      if (status) {
        where.status = status;
      }
      // Only show active (non-deleted) requests
      where.deletedAt = null;

      const requests = await prisma.request.findMany({
        where,
        include: {
          audiobook: true,
          user: {
            select: {
              id: true,
              plexUsername: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });

      return NextResponse.json({
        success: true,
        requests,
        count: requests.length,
      });
    } catch (error) {
      logger.error('Failed to get requests', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        {
          error: 'FetchError',
          message: 'Failed to fetch requests',
        },
        { status: 500 }
      );
    }
  });
}
