/**
 * Component: Admin Blocklist API (list + filter-scoped bulk clear)
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * GET    /api/admin/blocklist          → paginated, filtered, sorted list
 * DELETE /api/admin/blocklist?…filters → filter-scoped bulk clear ("Clear filtered (N)")
 *
 * `buildBlocklistWhere` is exported as a pure function for the route tests AND
 * for the DELETE handler to share with GET — the bulk clear MUST scope to the
 * exact same rows the user is currently viewing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@/generated/prisma';
import { RMABLogger } from '@/lib/utils/logger';
import { clearBlocklist } from '@/lib/services/blocklist.service';

const logger = RMABLogger.create('API.Admin.Blocklist');

const VALID_LIMITS = [25, 50, 100] as const;
const DEFAULT_LIMIT = 50;
const VALID_SOURCES = ['organize_fail', 'download_fail', 'manual'] as const;
const VALID_SORT_FIELDS = ['createdAt', 'releaseName', 'reason'] as const;
const VALID_SORT_ORDERS = ['asc', 'desc'] as const;

export interface BlocklistWhereParams {
  requestId?: string | null;
  source?: string | null;
  search?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

function parseLimit(raw: string | null): number {
  const n = Number(raw);
  return (VALID_LIMITS as readonly number[]).includes(n) ? n : DEFAULT_LIMIT;
}

function parsePage(raw: string | null): number {
  const n = parseInt(raw ?? '1', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function trim(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

/**
 * Build the Prisma where clause for blocklist queries.
 * Pure function — same input always yields same output. Exported for tests AND
 * for the DELETE handler so bulk-clear filter scope matches GET exactly.
 */
export function buildBlocklistWhere(
  params: BlocklistWhereParams
): Prisma.BlockedReleaseWhereInput {
  const where: Prisma.BlockedReleaseWhereInput = {};

  const requestId = trim(params.requestId);
  if (requestId) {
    where.requestId = requestId;
  }

  const source = trim(params.source);
  if (source && source !== 'all' && (VALID_SOURCES as readonly string[]).includes(source)) {
    where.source = source;
  }

  const from = parseDate(params.dateFrom);
  const to = parseDate(params.dateTo);
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  const search = trim(params.search);
  if (search) {
    where.OR = [
      { releaseName: { contains: search, mode: 'insensitive' } },
      { reason: { contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
}

function whereFromSearchParams(searchParams: URLSearchParams): Prisma.BlockedReleaseWhereInput {
  return buildBlocklistWhere({
    requestId: searchParams.get('requestId'),
    source: searchParams.get('source'),
    search: searchParams.get('search'),
    dateFrom: searchParams.get('dateFrom'),
    dateTo: searchParams.get('dateTo'),
  });
}

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { searchParams } = new URL(request.url);
        const page = parsePage(searchParams.get('page'));
        const limit = parseLimit(searchParams.get('limit'));

        const sortByRaw = searchParams.get('sortBy') ?? 'createdAt';
        const sortBy = (VALID_SORT_FIELDS as readonly string[]).includes(sortByRaw)
          ? (sortByRaw as (typeof VALID_SORT_FIELDS)[number])
          : 'createdAt';
        const sortOrderRaw = searchParams.get('sortOrder') ?? 'desc';
        const sortOrder = (VALID_SORT_ORDERS as readonly string[]).includes(sortOrderRaw)
          ? (sortOrderRaw as (typeof VALID_SORT_ORDERS)[number])
          : 'desc';

        const where = whereFromSearchParams(searchParams);

        const orderBy: Prisma.BlockedReleaseOrderByWithRelationInput = { [sortBy]: sortOrder };

        const skip = (page - 1) * limit;

        const [entries, totalCount] = await Promise.all([
          prisma.blockedRelease.findMany({
            where,
            select: {
              id: true,
              requestId: true,
              releaseName: true,
              releaseHash: true,
              indexerName: true,
              indexerId: true,
              source: true,
              reason: true,
              reasonDetail: true,
              downloadHistoryId: true,
              jobId: true,
              createdAt: true,
              request: {
                select: {
                  id: true,
                  deletedAt: true,
                  audiobook: { select: { title: true, author: true } },
                  user: { select: { plexUsername: true } },
                },
              },
            },
            orderBy,
            skip,
            take: limit,
          }),
          prisma.blockedRelease.count({ where }),
        ]);

        return NextResponse.json({
          entries,
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.max(1, Math.ceil(totalCount / limit)),
          },
        });
      } catch (error) {
        logger.error('Failed to fetch blocklist', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: 'Failed to fetch blocklist' },
          { status: 500 }
        );
      }
    });
  });
}

/**
 * DELETE /api/admin/blocklist?<same filter params as GET>
 *
 * Filter-scoped bulk clear. The "Clear filtered (N)" admin UI hits this with
 * the exact same query string used for the current GET. Returns the count of
 * rows actually deleted. Empty filters intentionally allowed — the UI gates
 * with a typed-token confirmation modal; the server's job is enforcing the
 * auth + admin boundary.
 */
export async function DELETE(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { searchParams } = new URL(request.url);
        const where = whereFromSearchParams(searchParams);
        const result = await clearBlocklist(where);
        return NextResponse.json({ count: result.count });
      } catch (error) {
        logger.error('Failed to clear blocklist', {
          error: error instanceof Error ? error.message : String(error),
        });
        return NextResponse.json(
          { error: 'Failed to clear blocklist' },
          { status: 500 }
        );
      }
    });
  });
}
