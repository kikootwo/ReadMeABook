/**
 * Component: Admin Requests API (Paginated)
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { Prisma } from '@/generated/prisma';
import { loadLinkedRows, withLibraryDisplay } from '@/lib/services/library/library-display';
import { getConfigService } from '@/lib/services/config.service';
import { BEING_IMPORTED_WHERE, deleteTouchesLibrary } from '@/lib/utils/delete-touches-library';

const logger = RMABLogger.create('API.Admin.Requests');

const VALID_SORT_FIELDS = ['createdAt', 'completedAt', 'title', 'user', 'status'] as const;
const VALID_SORT_ORDERS = ['asc', 'desc'] as const;
const VALID_PAGE_SIZES = [10, 25, 50, 100] as const;
const VALID_TYPES = ['audiobook', 'ebook'] as const;

type SortField = (typeof VALID_SORT_FIELDS)[number];
type SortOrder = (typeof VALID_SORT_ORDERS)[number];
type RequestType = (typeof VALID_TYPES)[number];

/**
 * Audiobookshelf only (#325a): ids of the library items followed by an available audiobook request
 * whose title or author matches. Plex mode never follows, so no query runs there.
 */
async function followedItemsMatching(text: Prisma.StringFilter): Promise<string[]> {
  if ((await getConfigService().getBackendMode()) !== 'audiobookshelf') return [];
  const followed = await prisma.audiobook.findMany({
    where: {
      libraryAsin: { not: null },
      absItemId: { not: null },
      requests: { some: { type: 'audiobook', status: 'available', deletedAt: null } },
    },
    select: { absItemId: true },
  });
  if (followed.length === 0) return [];
  const rows = await prisma.plexLibrary.findMany({
    where: { plexGuid: { in: followed.map((b) => b.absItemId!) }, OR: [{ title: text }, { author: text }] },
    select: { plexGuid: true },
    orderBy: { plexGuid: 'asc' },
  });
  return rows.map((r) => r.plexGuid);
}

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { searchParams } = new URL(request.url);

        // Parse query parameters
        const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
        const pageSizeParam = parseInt(searchParams.get('pageSize') || '25', 10);
        const pageSize = VALID_PAGE_SIZES.includes(pageSizeParam as (typeof VALID_PAGE_SIZES)[number])
          ? pageSizeParam
          : 25;
        const search = searchParams.get('search')?.trim() || '';
        const status = searchParams.get('status') || '';
        const typeParam = searchParams.get('type') || '';
        // Allowlisted: 'all', missing or unknown values mean no type filter
        const type: RequestType | null = VALID_TYPES.includes(typeParam as RequestType)
          ? (typeParam as RequestType)
          : null;
        const userId = searchParams.get('userId') || '';
        const sortByParam = searchParams.get('sortBy') || 'createdAt';
        const sortBy: SortField = VALID_SORT_FIELDS.includes(sortByParam as SortField)
          ? (sortByParam as SortField)
          : 'createdAt';
        const sortOrderParam = searchParams.get('sortOrder') || 'desc';
        const sortOrder: SortOrder = VALID_SORT_ORDERS.includes(sortOrderParam as SortOrder)
          ? (sortOrderParam as SortOrder)
          : 'desc';

        // Build where clause
        const where: Prisma.RequestWhereInput = {
          deletedAt: null,
        };

        // Filter by status
        if (status && status !== 'all') {
          where.status = status;
        }

        // Filter by request type
        if (type) {
          where.type = type;
        }

        // Filter by user
        if (userId) {
          where.userId = userId;
        }

        // Search by title or author: the requested ones, or (a followed audiobook request, #325a)
        // the linked library item's. The title sort stays on the requested title.
        if (search) {
          const text = { contains: search, mode: 'insensitive' as const };
          const requested: Prisma.RequestWhereInput = { audiobook: { OR: [{ title: text }, { author: text }] } };
          const items = await followedItemsMatching(text);
          where.OR = items.length === 0 ? [requested] : [requested, {
            type: 'audiobook',
            status: 'available',
            audiobook: { libraryAsin: { not: null }, absItemId: { in: items } },
          }];
        }

        // Build orderBy clause
        let orderBy: Prisma.RequestOrderByWithRelationInput;
        switch (sortBy) {
          case 'title':
            orderBy = { audiobook: { title: sortOrder } };
            break;
          case 'user':
            orderBy = { user: { plexUsername: sortOrder } };
            break;
          case 'completedAt':
            // Sort nulls last for completedAt
            orderBy = { completedAt: { sort: sortOrder, nulls: 'last' } };
            break;
          case 'status':
            orderBy = { status: sortOrder };
            break;
          case 'createdAt':
          default:
            orderBy = { createdAt: sortOrder };
            break;
        }

        // Get total count for pagination
        const total = await prisma.request.count({ where });

        // Get paginated requests
        const requests = await prisma.request.findMany({
          where,
          include: {
            audiobook: {
              select: {
                id: true,
                title: true,
                author: true,
                audibleAsin: true,
                absItemId: true,
                libraryAsin: true,
                // Read only for the derived inLibrary flag, never returned
                filePath: true,
                plexGuid: true,
                requests: { where: BEING_IMPORTED_WHERE, select: { id: true }, take: 1 },
              },
            },
            user: {
              select: {
                id: true,
                plexUsername: true,
              },
            },
            downloadHistory: {
              where: {
                selected: true,
              },
              select: {
                torrentUrl: true,
              },
              orderBy: { createdAt: 'desc' }, // the newest selected row (#332)
              take: 1,
            },
            _count: {
              select: {
                blockedReleases: true,
              },
            },
          },
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
        });

        // Format response. `title`/`author`/`asin` stay the requested ones (every row action and
        // View details use them); `displayTitle`/`displayAuthor` follow the library (#325a) and
        // `libraryAsin` is the effective library ASIN.
        const rows = await loadLinkedRows(requests);
        const formatted = requests.map((request) => {
          const shown = withLibraryDisplay(request.audiobook, rows, request);
          return {
            requestId: request.id,
            title: request.audiobook.title,
            author: request.audiobook.author,
            displayTitle: shown.title,
            displayAuthor: shown.author,
            asin: request.audiobook.audibleAsin || null,
            libraryAsin: shown.libraryAsin,
            status: request.status,
            progress: request.progress, // processing: under 100 only while chapters merge (#216)
            type: request.type || 'audiobook', // Include request type for UI display
            userId: request.user.id,
            user: request.user.plexUsername,
            createdAt: request.createdAt,
            completedAt: request.completedAt,
            errorMessage: request.errorMessage,
            torrentUrl: request.downloadHistory[0]?.torrentUrl || null,
            downloadAttempts: request.downloadAttempts,
            customSearchTerms: request.customSearchTerms || null,
            blockedCount: request._count?.blockedReleases ?? 0,
            explicit: request.explicit === true, // #542
            // Bulk delete leaves these alone (#212); derived, so stored paths never leave the server
            inLibrary: deleteTouchesLibrary(request, (request.audiobook.requests?.length ?? 0) > 0),
          };
        });

        return NextResponse.json({
          requests: formatted,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        });
      } catch (error) {
        logger.error('Failed to fetch requests', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json({ error: 'Failed to fetch requests' }, { status: 500 });
      }
    });
  });
}
