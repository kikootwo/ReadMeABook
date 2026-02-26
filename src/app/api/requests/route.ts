/**
 * Component: Requests API Routes
 * Documentation: documentation/backend/api.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';
import { RMABLogger } from '@/lib/utils/logger';
import { createRequestForUser } from '@/lib/services/request-creator.service';
import { generateDownloadToken } from '@/lib/utils/jwt';

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

      const skipAutoSearch = req.nextUrl.searchParams.get('skipAutoSearch') === 'true';

      const result = await createRequestForUser(req.user.id, {
        asin: audiobook.asin,
        title: audiobook.title,
        author: audiobook.author,
        narrator: audiobook.narrator,
        description: audiobook.description,
        coverArtUrl: audiobook.coverArtUrl,
      }, { skipAutoSearch });

      if (!result.success) {
        const statusMap: Record<string, { error: string; status: number }> = {
          already_available: { error: 'AlreadyAvailable', status: 409 },
          being_processed: { error: 'BeingProcessed', status: 409 },
          duplicate: { error: 'DuplicateRequest', status: 409 },
          user_not_found: { error: 'UserNotFound', status: 404 },
        };
        const mapped = statusMap[result.reason] || { error: 'RequestError', status: 500 };
        return NextResponse.json(
          { error: mapped.error, message: result.message },
          { status: mapped.status }
        );
      }

      return NextResponse.json({
        success: true,
        request: result.request,
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
      const type = searchParams.get('type'); // 'audiobook', 'ebook', or null for all
      const isAdmin = req.user.role === 'admin';

      // Build query
      // If myOnly=true, always filter by current user (even for admins)
      // Otherwise, admins see all requests, users see only their own
      const where: any = myOnly || !isAdmin ? { userId: req.user.id } : {};
      if (status) {
        where.status = status;
      }
      // Filter by type if specified (otherwise returns all types)
      if (type && ['audiobook', 'ebook'].includes(type)) {
        where.type = type;
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

      const COMPLETED_STATUSES = ['available', 'downloaded'];
      const enriched = requests.map(r => {
        const isCompleted = COMPLETED_STATUSES.includes(r.status);
        const hasFile = isCompleted && r.audiobook?.filePath;
        if (!hasFile) return r;
        const token = generateDownloadToken(req.user!.id, r.id);
        return { ...r, downloadUrl: `/api/requests/${r.id}/download?token=${token}` };
      });

      return NextResponse.json({
        success: true,
        requests: enriched,
        count: enriched.length,
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
