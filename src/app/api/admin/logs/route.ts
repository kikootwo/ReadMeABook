/**
 * Component: Admin Logs API
 * Documentation: documentation/admin-dashboard.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('API.Admin.Logs');

const VALID_LIMITS = [25, 50, 100] as const;
const DEFAULT_LIMIT = 50;
const ERROR_STATUSES = ['failed', 'stuck'] as const;

export interface LogsWhereParams {
  status?: string | null;
  type?: string | null;
  search?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  hasError?: string | null;
  userId?: string | null;
  audiobookQuery?: string | null;
}

function parseLimit(raw: string | null): number {
  const n = Number(raw);
  return (VALID_LIMITS as readonly number[]).includes(n) ? n : DEFAULT_LIMIT;
}

function parsePage(raw: string | null): number {
  const n = parseInt(raw ?? '1', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function isTruthy(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v === 'true' || v === '1';
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

export function buildLogsWhere(params: LogsWhereParams): Record<string, any> {
  const where: Record<string, any> = {};

  const status = params.status ?? 'all';
  if (status !== 'all' && status !== '') {
    where.status = status;
  }

  const type = params.type ?? 'all';
  if (type !== 'all' && type !== '') {
    where.type = type;
  }

  const from = parseDate(params.dateFrom);
  const to = parseDate(params.dateTo);
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  const userId = trim(params.userId);
  if (userId) {
    where.request = { is: { userId } };
  }

  const audiobookQuery = trim(params.audiobookQuery);
  if (audiobookQuery) {
    where.request = {
      is: {
        ...(where.request?.is ?? {}),
        audiobook: {
          is: {
            OR: [
              { title: { contains: audiobookQuery, mode: 'insensitive' } },
              { author: { contains: audiobookQuery, mode: 'insensitive' } },
            ],
          },
        },
      },
    };
  }

  const errorsOnly = isTruthy(params.hasError);
  const search = trim(params.search);

  const errorsOr = errorsOnly
    ? [
        { status: { in: [...ERROR_STATUSES] } },
        { errorMessage: { not: null } },
      ]
    : null;

  const searchOr = search
    ? [
        { bullJobId: { startsWith: search } },
        { errorMessage: { contains: search, mode: 'insensitive' } },
        // TODO: revisit if slow — consider denormalized lastEventMessage on Job
        { events: { some: { message: { contains: search, mode: 'insensitive' } } } },
        { request: { is: { audiobook: { is: { title: { contains: search, mode: 'insensitive' } } } } } },
        { request: { is: { audiobook: { is: { author: { contains: search, mode: 'insensitive' } } } } } },
        { request: { is: { user: { is: { plexUsername: { contains: search, mode: 'insensitive' } } } } } },
      ]
    : null;

  if (errorsOr && searchOr) {
    where.AND = [{ OR: errorsOr }, { OR: searchOr }];
  } else if (errorsOr) {
    where.OR = errorsOr;
  } else if (searchOr) {
    where.OR = searchOr;
  }

  return where;
}

export async function GET(request: NextRequest) {
  return requireAuth(request, async (req: AuthenticatedRequest) => {
    return requireAdmin(req, async () => {
      try {
        const { searchParams } = new URL(request.url);
        const page = parsePage(searchParams.get('page'));
        const limit = parseLimit(searchParams.get('limit'));

        const where = buildLogsWhere({
          status: searchParams.get('status'),
          type: searchParams.get('type'),
          search: searchParams.get('search'),
          dateFrom: searchParams.get('dateFrom'),
          dateTo: searchParams.get('dateTo'),
          hasError: searchParams.get('hasError'),
          userId: searchParams.get('userId'),
          audiobookQuery: searchParams.get('audiobookQuery'),
        });

        const skip = (page - 1) * limit;

        const [logs, totalCount] = await Promise.all([
          prisma.job.findMany({
            where,
            select: {
              id: true,
              bullJobId: true,
              type: true,
              status: true,
              priority: true,
              attempts: true,
              maxAttempts: true,
              errorMessage: true,
              startedAt: true,
              completedAt: true,
              createdAt: true,
              updatedAt: true,
              result: true,
              events: {
                select: {
                  id: true,
                  level: true,
                  context: true,
                  message: true,
                  metadata: true,
                  createdAt: true,
                },
                orderBy: {
                  createdAt: 'asc',
                },
              },
              request: {
                select: {
                  id: true,
                  audiobook: {
                    select: {
                      title: true,
                      author: true,
                    },
                  },
                  user: {
                    select: {
                      plexUsername: true,
                    },
                  },
                },
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
            skip,
            take: limit,
          }),
          prisma.job.count({ where }),
        ]);

        return NextResponse.json({
          logs,
          pagination: {
            page,
            limit,
            total: totalCount,
            totalPages: Math.ceil(totalCount / limit),
          },
        });
      } catch (error) {
        logger.error('Failed to fetch logs', { error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json(
          { error: 'Failed to fetch logs' },
          { status: 500 }
        );
      }
    });
  });
}
