/**
 * Component: Cleanup Seeded Torrents - Cancelled-Download Pass
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Runs after the seeding pass of cleanup_seeded_torrents. Retries what a cancel could not do:
 * a partial torrent RMAB added is removed; a finished one is kept until its indexer's seeding rule
 * is met, then removed. Same decision as the cancel itself (cancelled-download.ts). Only requests
 * cancelled after cancelledAt existed (NULL = cancelled before the upgrade: never touched), torrents
 * only. Keyset paging (id > last); every candidate is visited every run.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { handleCancelledDownload, type IndexerLookup } from '../services/cancelled-download';

export interface CancelledPassCounts {
  checked: number;
  removed: number;
  keptSeeding: number;
  keptUnlimited: number;
  keptShared: number;
  notOwned: number;
  missing: number;
  errors: number;
}

export interface CancelledPassOptions {
  lookupIndexer: IndexerLookup;
  /** Torrents removed earlier in this run (lower-case ids), shared with the seeding pass */
  deletedHashes: Set<string>;
  pageSize: number;
  maxProbeErrorsInARow: number;
  logger: RMABLogger;
}

const NOT_GONE = { OR: [{ downloadStatus: null }, { downloadStatus: { notIn: ['removed', 'failed'] } }] };
// Removed, failed, usenet and not-RMAB rows drop out here (a bare `not` would also drop NULL statuses)
const CANDIDATE = {
  status: 'cancelled',
  cancelledAt: { not: null },
  deletedAt: null,
  downloadHistory: {
    some: {
      selected: true,
      torrentHash: { not: null },
      AND: [NOT_GONE, { OR: [{ addedByRmab: true }, { addedByRmab: null }] }],
    },
  },
};

export function emptyCancelledPassCounts(): CancelledPassCounts {
  return { checked: 0, removed: 0, keptSeeding: 0, keptUnlimited: 0, keptShared: 0, notOwned: 0, missing: 0, errors: 0 };
}

/** Never throws: a failure is logged and the counts so far are returned */
export async function cleanUpCancelledDownloads(options: CancelledPassOptions): Promise<CancelledPassCounts & { stoppedEarly: boolean }> {
  const { lookupIndexer, deletedHashes, pageSize, maxProbeErrorsInARow, logger } = options;
  const counts = emptyCancelledPassCounts();
  let probeErrorsInARow = 0;
  let stoppedEarly = false;
  let lastId: string | undefined;

  try {
    for (;;) {
      const page = await prisma.request.findMany({
        where: { AND: [CANDIDATE, ...(lastId ? [{ id: { gt: lastId } }] : [])] },
        select: {
          id: true,
          audiobookId: true,
          type: true,
          // The newest selected row only: an older attempt is never walked back to
          downloadHistory: { where: { selected: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { id: 'asc' },
        take: pageSize,
      });

      for (const request of page) {
        counts.checked++;
        const step = await handleCancelledDownload(request, request.downloadHistory[0] ?? null, {
          mode: 'sweep',
          deletedHashes,
          lookupIndexer,
        });
        // Only a lookup the client answered resets the count (a step with no client call says nothing)
        if (step.probeError) probeErrorsInARow++;
        else if (step.probed) probeErrorsInARow = 0;
        switch (step.outcome) {
          case 'removed': counts.removed++; break;
          case 'kept_seeding': counts.keptSeeding++; break;
          case 'kept_unlimited': counts.keptUnlimited++; break;
          case 'kept_shared': counts.keptShared++; break;
          case 'kept_not_owned': counts.notOwned++; break;
          case 'retry_later': counts.errors++; break;
          default: if (step.missing) counts.missing++;
        }
        if (probeErrorsInARow >= maxProbeErrorsInARow) {
          stoppedEarly = true;
          break;
        }
      }

      if (stoppedEarly) {
        logger.warn(`Cancelled downloads: stopped after ${probeErrorsInARow} could not be checked in a row; the next run tries again`);
        break;
      }
      if (page.length < pageSize) break;
      lastId = page[page.length - 1].id;
    }
  } catch (error) {
    counts.errors++;
    logger.error(`Cancelled-download pass failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  logger.info(
    `Cancelled downloads: ${counts.checked} checked, ${counts.removed} removed, ${counts.keptSeeding} still seeding, `
    + `${counts.keptUnlimited} unlimited, ${counts.keptShared} kept for other requests, ${counts.notOwned} not added by RMAB (kept), `
    + `${counts.missing} gone from the client, ${counts.errors} errors`
  );
  return { ...counts, stoppedEarly };
}
