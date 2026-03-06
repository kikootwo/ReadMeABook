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
import { COMPLETED_STATUSES } from '@/lib/constants/request-statuses';

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

// Status groups for server-side filtering and count aggregation
const STATUS_GROUPS: Record<string, string[]> = {
  active:    ['pending', 'searching', 'downloading', 'processing'],
  waiting:   ['awaiting_search', 'awaiting_import', 'awaiting_approval'],
  completed: ['available', 'downloaded'],
  failed:    ['failed'],
  cancelled: ['cancelled', 'denied'],
};

/**
 * GET /api/requests
 * Get user's audiobook requests with cursor-based pagination and accurate counts.
 *
 * Query params:
 *   status   - filter group: 'active'|'waiting'|'completed'|'failed'|'cancelled'|specific status
 *   cursor   - request ID for cursor-based pagination (exclusive start)
 *   take     - page size (default 20, max 100)
 *   myOnly   - 'true' to restrict to current user even for admins
 *   type     - 'audiobook'|'ebook'
 *
 * Response: { requests, nextCursor, counts: { all, active, waiting, completed, failed, cancelled } }
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
      const statusParam = searchParams.get('status');
      const cursor = searchParams.get('cursor');
      const take = Math.min(parseInt(searchParams.get('take') || '20', 10), 100);
      // Legacy support: honour `limit` if `take` not supplied
      const limit = searchParams.has('take')
        ? take
        : Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
      const myOnly = searchParams.get('myOnly') === 'true';
      const type = searchParams.get('type');
      const isAdmin = req.user.role === 'admin';

      // Base ownership filter
      const baseWhere: any = myOnly || !isAdmin ? { userId: req.user.id } : {};
      baseWhere.deletedAt = null;

      if (type && ['audiobook', 'ebook'].includes(type)) {
        baseWhere.type = type;
      }

      // Resolve status filter
      const statusFilter: any = {};
      if (statusParam) {
        const group = STATUS_GROUPS[statusParam];
        if (group) {
          statusFilter.status = { in: group };
        } else {
          // Treat as a specific status literal
          statusFilter.status = statusParam;
        }
      }

      const where = { ...baseWhere, ...statusFilter };

      // ── Paginated request fetch ──────────────────────────────────────────
      const requests = await prisma.request.findMany({
        where,
        include: {
          audiobook: true,
          user: {
            select: { id: true, plexUsername: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit + 1, // fetch one extra to determine if there's a next page
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      const hasNextPage = requests.length > limit;
      const page = hasNextPage ? requests.slice(0, limit) : requests;
      const nextCursor = hasNextPage ? page[page.length - 1].id : null;

      const enriched = page.map(r => {
        const isCompleted = COMPLETED_STATUSES.includes(r.status as typeof COMPLETED_STATUSES[number]);
        const downloadAvailable = isCompleted && !!r.audiobook?.filePath;
        const audiobook = r.audiobook ? { ...r.audiobook, filePath: undefined } : r.audiobook;
        return { ...r, audiobook, downloadAvailable };
      });

      // ── Accurate counts per group (always scoped to ownership/type filter) ──
      const countWhere = { ...baseWhere };

      const [
        totalAll,
        totalActive,
        totalWaiting,
        totalCompleted,
        totalFailed,
        totalCancelled,
      ] = await Promise.all([
        prisma.request.count({ where: countWhere }),
        prisma.request.count({ where: { ...countWhere, status: { in: STATUS_GROUPS.active } } }),
        prisma.request.count({ where: { ...countWhere, status: { in: STATUS_GROUPS.waiting } } }),
        prisma.request.count({ where: { ...countWhere, status: { in: STATUS_GROUPS.completed } } }),
        prisma.request.count({ where: { ...countWhere, status: { in: STATUS_GROUPS.failed } } }),
        prisma.request.count({ where: { ...countWhere, status: { in: STATUS_GROUPS.cancelled } } }),
      ]);

      return NextResponse.json({
        success: true,
        requests: enriched,
        nextCursor,
        counts: {
          all:       totalAll,
          active:    totalActive,
          waiting:   totalWaiting,
          completed: totalCompleted,
          failed:    totalFailed,
          cancelled: totalCancelled,
        },
        // Legacy field for callers that still read `count`
        count: enriched.length,
      });
    } catch (error) {
      logger.error('Failed to get requests', { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: 'FetchError', message: 'Failed to fetch requests' },
        { status: 500 }
      );
    }
  });
}
