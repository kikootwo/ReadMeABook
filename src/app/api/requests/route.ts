/**
 * Component: Requests API Routes
 * Documentation: documentation/backend/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { getJobQueueService } from '@/lib/services/job-queue.service';
import { findPlexMatch } from '@/lib/utils/audiobook-matcher';
import { z } from 'zod';

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
    rating: z.number().optional(),
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

      // Check if audiobook is already available in Plex library
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
            status: 'requested',
          },
        });
      }

      // Check if user already has a request for this audiobook
      const existingRequest = await prisma.request.findUnique({
        where: {
          userId_audiobookId: {
            userId: req.user.id,
            audiobookId: audiobookRecord.id,
          },
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
        console.log(`[Requests] Deleting existing ${existingRequest.status} request ${existingRequest.id} to allow re-request`);
        await prisma.request.delete({
          where: { id: existingRequest.id },
        });
      }

      // Create request
      const newRequest = await prisma.request.create({
        data: {
          userId: req.user.id,
          audiobookId: audiobookRecord.id,
          status: 'pending',
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

      // Trigger search job
      const jobQueue = getJobQueueService();
      await jobQueue.addSearchJob(newRequest.id, {
        id: audiobookRecord.id,
        title: audiobookRecord.title,
        author: audiobookRecord.author,
      });

      return NextResponse.json({
        success: true,
        request: newRequest,
      }, { status: 201 });
    } catch (error) {
      console.error('Failed to create request:', error);

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
      console.error('Failed to get requests:', error);
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
