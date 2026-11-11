/**
 * Component: Import Lists API helpers
 * Documentation: documentation/backend/services/list-sync.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '@/lib/middleware/auth';
import type { ImportList, ImportListFilterProfile, ImportListSyncLog } from '@/generated/prisma/client';

/** Run a handler only for authenticated admins. */
export function adminOnly(request: NextRequest, handler: (req: AuthenticatedRequest) => Promise<NextResponse>) {
  return requireAuth(request, (req: AuthenticatedRequest) => requireAdmin(req, () => handler(req)));
}

type ListWithRelations = ImportList & {
  filterProfile: Pick<ImportListFilterProfile, 'id' | 'name'> | null;
  logs: ImportListSyncLog[];
};

/** Shape sent to the screen: settings, status badge and the latest run's counters. */
export function serializeList(list: ListWithRelations) {
  const last = list.logs[0];
  const syncing = !!last && last.completedAt === null && Date.now() - last.startedAt.getTime() < 2 * 3_600_000;
  const status = syncing ? 'syncing' : !list.enabled ? 'paused' : list.lastError ? 'error' : list.lastSyncedAt ? 'ok' : 'new';
  return {
    id: list.id,
    name: list.name,
    provider: list.provider,
    listId: list.listId,
    url: `https://www.goodreads.com/list/show/${list.listId}`,
    enabled: list.enabled,
    autoRequest: list.autoRequest,
    syncIntervalHours: list.syncIntervalHours,
    topN: list.topN,
    maxRequestsPerSync: list.maxRequestsPerSync,
    filterProfileId: list.filterProfileId,
    filterProfileName: list.filterProfile?.name ?? null,
    sourceSize: list.sourceSize,
    status,
    lastSyncedAt: list.lastSyncedAt,
    lastSuccessfulSyncAt: list.lastSuccessfulSyncAt,
    lastError: list.lastError,
    lastRun: last
      ? {
          startedAt: last.startedAt,
          completedAt: last.completedAt,
          fetched: last.fetched,
          newOnList: last.newOnList,
          filtered: last.filtered,
          missed: last.missed,
          alreadyHave: last.alreadyHave,
          skipped: last.skipped,
          requested: last.requested,
          stoppedReason: last.stoppedReason,
        }
      : null,
  };
}

export const LIST_INCLUDE = {
  filterProfile: { select: { id: true, name: true } },
  logs: { orderBy: { startedAt: 'desc' as const }, take: 1 },
};
