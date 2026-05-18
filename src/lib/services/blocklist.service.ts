/**
 * Component: Release Blocklist Service
 * Documentation: documentation/backend/database.md
 *
 * Single writer for the BlockedRelease table. Search processors call into this
 * service when a download or organize-files step fails permanently so the next
 * search for that request skips the same release.
 *
 * Invariant: addAutoBlock NEVER throws. A failed blocklist write must not break
 * the originating processor or prevent the request from transitioning to `warn`.
 */

import { prisma } from '@/lib/db';
import { Prisma, type BlockedRelease } from '@/generated/prisma';
import { RMABLogger } from '@/lib/utils/logger';
import { normalizeReleaseKey } from '@/lib/utils/release-key';

const logger = RMABLogger.create('Blocklist');

export type BlockSource = 'organize_fail' | 'download_fail';

export interface AddAutoBlockInput {
  requestId: string;
  releaseName: string;
  source: BlockSource;
  /** Short, human-readable. E.g. "No audiobook files found", "Download failed (par2)" */
  reason: string;
  /** torrentHash (qBit) OR nzbId (SAB / NZBGet). Mutually exclusive in source. */
  releaseHash?: string | null;
  indexerName?: string | null;
  indexerId?: number | null;
  /** Raw client error string (SAB failMessage, NZBGet Par/Unpack code, etc.) */
  reasonDetail?: string | null;
  /** Links to the specific DownloadHistory row that drove this block. */
  downloadHistoryId?: string | null;
  /** When provided, a JobEvent log entry is emitted via RMABLogger.forJob. */
  jobId?: string | null;
}

export interface AddAutoBlockResult {
  blocked: BlockedRelease | null;
  wasNew: boolean;
}

/**
 * Idempotently record a blocked release for a request.
 *
 * Behavior:
 * - Upserts on the unique `(requestId, releaseKey)` index so concurrent writes
 *   converge on a single row (first writer wins on metadata; subsequent calls
 *   are a no-op update).
 * - Emits a JobEvent log line (context `Blocklist.AutoBlock`) when `jobId` is
 *   provided. The logger persists it to `job_events` automatically.
 * - NEVER throws. On DB failure, logs the error and returns
 *   `{ blocked: null, wasNew: false }` so the caller's lifecycle continues.
 */
export async function addAutoBlock(
  input: AddAutoBlockInput
): Promise<AddAutoBlockResult> {
  const releaseKey = normalizeReleaseKey(input.releaseName);
  const before = new Date();

  try {
    const blocked = await prisma.blockedRelease.upsert({
      where: { requestId_releaseKey: { requestId: input.requestId, releaseKey } },
      create: {
        requestId: input.requestId,
        releaseName: input.releaseName,
        releaseKey,
        releaseHash: input.releaseHash ?? null,
        indexerName: input.indexerName ?? null,
        indexerId: input.indexerId ?? null,
        source: input.source,
        reason: input.reason,
        reasonDetail: input.reasonDetail ?? null,
        downloadHistoryId: input.downloadHistoryId ?? null,
        jobId: input.jobId ?? null,
      },
      update: {},
    });

    const wasNew = blocked.createdAt >= before;

    if (input.jobId) {
      RMABLogger.forJob(input.jobId, 'Blocklist.AutoBlock').info(
        wasNew
          ? `Blocked release: ${input.releaseName}`
          : `Release already blocked: ${input.releaseName}`,
        {
          requestId: input.requestId,
          source: input.source,
          reason: input.reason,
          releaseHash: input.releaseHash ?? undefined,
          indexerName: input.indexerName ?? undefined,
          downloadHistoryId: input.downloadHistoryId ?? undefined,
          wasNew,
        }
      );
    }

    return { blocked, wasNew };
  } catch (error) {
    logger.error('Failed to record blocked release', {
      error: error instanceof Error ? error.message : String(error),
      requestId: input.requestId,
      releaseName: input.releaseName,
      source: input.source,
    });
    return { blocked: null, wasNew: false };
  }
}

/**
 * Check whether a release should be filtered out for a given request.
 * Matches on normalized name OR on hash (when both sides have one).
 */
export async function isReleaseBlocked(
  requestId: string,
  releaseName: string,
  releaseHash?: string | null
): Promise<boolean> {
  const releaseKey = normalizeReleaseKey(releaseName);

  const orClauses: Prisma.BlockedReleaseWhereInput[] = [{ releaseKey }];
  if (releaseHash) {
    orClauses.push({ releaseHash });
  }

  const hit = await prisma.blockedRelease.findFirst({
    where: { requestId, OR: orClauses },
    select: { id: true },
  });

  return hit !== null;
}

/**
 * Return every blocklist entry for a request, newest first.
 * Used by the request-detail admin chip (Phase 5).
 */
export async function getBlocklistForRequest(
  requestId: string
): Promise<BlockedRelease[]> {
  return prisma.blockedRelease.findMany({
    where: { requestId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Remove a single blocklist entry by id. Used by the admin "Unblock" action.
 */
export async function removeBlock(id: string): Promise<void> {
  await prisma.blockedRelease.delete({ where: { id } });
}

/**
 * Bulk delete blocklist entries matching the provided where clause. The admin
 * "Clear filtered (N)" action passes the same where clause used by the listing
 * query so the operation is filter-scoped, never a global wipe.
 */
export async function clearBlocklist(
  where: Prisma.BlockedReleaseWhereInput
): Promise<{ count: number }> {
  const result = await prisma.blockedRelease.deleteMany({ where });
  return { count: result.count };
}
