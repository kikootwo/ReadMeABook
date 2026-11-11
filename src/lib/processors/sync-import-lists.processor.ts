/**
 * Component: Sync Import Lists Processor
 * Documentation: documentation/backend/services/list-sync.md
 *
 * Scheduled sweep: syncs every enabled import list that is due, within the hourly request
 * allowance. A specific list (manual "sync now") is synced regardless of schedule.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import {
  computeHourlyBudget,
  ensureSeedProfiles,
  ImportListSyncInProgressError,
  isDue,
  syncImportList,
} from '../services/import-lists/sync.service';

export interface SyncImportListsPayload {
  jobId?: string;
  scheduledJobId?: string;
  /** If set, sync only this list now, ignoring its schedule and the hourly allowance */
  listId?: string;
}

export interface SyncImportListsResult {
  listsSynced: number;
  requested: number;
  errors: number;
  skippedBusy: number;
  skippedNoAllowance: number;
}

export async function processSyncImportLists(payload: SyncImportListsPayload): Promise<SyncImportListsResult> {
  const logger = RMABLogger.forJob(payload.jobId, 'SyncImportLists');
  const stats = { listsSynced: 0, requested: 0, errors: 0, skippedBusy: 0, skippedNoAllowance: 0 };

  await ensureSeedProfiles();

  const lists = payload.listId
    ? await prisma.importList.findMany({ where: { id: payload.listId } })
    : (
        // Least recently synced first (never-synced lists first), so the hourly allowance rotates fairly across lists
        await prisma.importList.findMany({ where: { enabled: true }, orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } } })
      ).filter((l) => isDue(l));

  if (lists.length === 0) {
    logger.info(payload.listId ? 'List not found' : 'No import lists are due');
    return stats;
  }

  const budget = payload.listId ? undefined : await computeHourlyBudget();
  logger.info(`Syncing ${lists.length} import list(s)` + (budget ? ` (allowance: ${budget.remaining} requests this hour)` : ''));

  for (const list of lists) {
    // Nothing left to request this hour: skip lists that would only request, but still sync tracking-only lists
    if (budget && budget.remaining <= 0 && list.autoRequest) {
      stats.skippedNoAllowance++;
      continue;
    }
    try {
      const summary = await syncImportList(list.id, budget);
      stats.listsSynced++;
      stats.requested += summary.requested;
      if (summary.errorMessage) stats.errors++;
    } catch (error) {
      if (error instanceof ImportListSyncInProgressError) {
        stats.skippedBusy++;
      } else {
        stats.errors++;
        logger.error(`Import list "${list.name}" failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  logger.info(`Import lists sweep done: ${stats.listsSynced} synced, ${stats.requested} requested, ${stats.errors} errors`);
  return stats;
}
