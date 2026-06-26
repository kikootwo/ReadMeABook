/**
 * Component: Find Missing Ebooks Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Safety-net scheduled job for issue #191. Scans completed audiobook requests
 * (downloaded | available) and triggers the existing ebook fetch flow for any
 * audiobook whose ebook companion is missing, failed, or warned out.
 *
 * Gated by ebook_auto_grab_enabled AND at least one ebook source enabled.
 * Per-run scan cap = 50. Per-audiobook lifetime auto-retry cap = 5
 * (tracked in Request.ebookAutoRetryCount; counter is processor-private —
 * manual Fetch Ebook never touches it).
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getJobQueueService } from '../services/job-queue.service';
import { getConfigService } from '../services/config.service';

export interface FindMissingEbooksPayload {
  jobId?: string;
  scheduledJobId?: string;
}

interface CandidateRow {
  parent_request_id: string;
  user_id: string;
  audiobook_id: string;
  custom_search_terms: string | null;
  audiobook_title: string;
  audiobook_author: string;
  audible_asin: string | null;
  ebook_request_id: string | null;
  ebook_status: string | null;
  ebook_auto_retry_count: number | null;
}

// Statuses indicating an in-flight ebook request that must not be duplicated
// or re-triggered. `awaiting_release` is included per engineering brief's
// "include awaiting_release in the in-flight skip set" directive.
const IN_FLIGHT_STATUSES = new Set([
  'pending',
  'awaiting_approval',
  'searching',
  'downloading',
  'processing',
  'awaiting_search',
  'awaiting_release',
  'unavailable',
]);

const AUTO_RETRY_CAP = 5;
const PER_RUN_LIMIT = 50;

export async function processFindMissingEbooks(payload: FindMissingEbooksPayload): Promise<any> {
  const { jobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'FindMissingEbooks');

  logger.info('Starting find_missing_ebooks pass');

  const zeroResult = (message: string, action: 'skipped-auto-grab-off' | 'skipped-no-source') => {
    logger.info(message, { action });
    return {
      success: true,
      message,
      scanned: 0,
      gapsFound: 0,
      triggered: 0,
      created: 0,
      retried: 0,
      skippedInFlight: 0,
      skippedCancelled: 0,
      skippedCapHit: 0,
    };
  };

  try {
    const configService = getConfigService();

    // Gate #1 — auto-grab feature toggle
    // Default ON when key is absent/null (matches organize-files.processor.ts).
    const autoGrab = await configService.get('ebook_auto_grab_enabled');
    if (autoGrab === 'false') {
      return zeroResult('Auto-grab disabled, skipping', 'skipped-auto-grab-off');
    }

    // Gate #2 — at least one ebook source enabled
    // Includes legacy back-compat shim: ebook_sidecar_enabled === 'true' counts
    // as Anna's Archive ON if the new key is absent (mirrors manual fetch route).
    const [annasArchive, indexerSearch, legacy] = await Promise.all([
      configService.get('ebook_annas_archive_enabled'),
      configService.get('ebook_indexer_search_enabled'),
      configService.get('ebook_sidecar_enabled'),
    ]);
    const annasOn = annasArchive === 'true' || (annasArchive == null && legacy === 'true');
    const indexerOn = indexerSearch === 'true';
    if (!annasOn && !indexerOn) {
      return zeroResult('No ebook sources enabled, skipping', 'skipped-no-source');
    }

    // Anti-join: most-recent non-deleted ebook child per in-scope audiobook.
    // Broad form — branch fully in JS so per-skip counters and log lines are
    // observable. LIMIT is the per-run scan cap.
    const candidates = await prisma.$queryRaw<CandidateRow[]>`
      SELECT
        p.id                  AS parent_request_id,
        p.user_id             AS user_id,
        p.audiobook_id        AS audiobook_id,
        p.custom_search_terms AS custom_search_terms,
        a.title               AS audiobook_title,
        a.author              AS audiobook_author,
        a.audible_asin        AS audible_asin,
        e.id                  AS ebook_request_id,
        e.status              AS ebook_status,
        e.ebook_auto_retry_count AS ebook_auto_retry_count
      FROM requests p
      JOIN audiobooks a ON a.id = p.audiobook_id
      LEFT JOIN LATERAL (
        SELECT id, status, ebook_auto_retry_count
        FROM requests
        WHERE parent_request_id = p.id
          AND type = 'ebook'
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      ) e ON TRUE
      WHERE p.status IN ('downloaded', 'available')
        AND (p.type IS NULL OR p.type <> 'ebook')
        AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
      LIMIT ${PER_RUN_LIMIT}
    `;

    const scanned = candidates.length;
    logger.info(`Scanned ${scanned} in-scope audiobook request(s)`);

    if (scanned === 0) {
      return {
        success: true,
        message: 'No in-scope audiobook requests',
        scanned: 0,
        gapsFound: 0,
        triggered: 0,
        created: 0,
        retried: 0,
        skippedInFlight: 0,
        skippedCancelled: 0,
        skippedCapHit: 0,
      };
    }

    const jobQueue = getJobQueueService();
    let gapsFound = 0;
    let created = 0;
    let retried = 0;
    let skippedInFlight = 0;
    let skippedCancelled = 0;
    let skippedCapHit = 0;

    for (const row of candidates) {
      let action:
        | 'created'
        | 'retried'
        | 'skipped-has-companion'
        | 'skipped-in-flight'
        | 'skipped-cancelled'
        | 'skipped-cap'
        | 'skipped-unknown'
        | null = null;
      let ebookRequestId: string | null = row.ebook_request_id;

      try {
        await prisma.$transaction(async (tx) => {
          if (!row.ebook_request_id) {
            // No live ebook child — create one and seed counter at 1.
            const createdRow = await tx.request.create({
              data: {
                userId: row.user_id,
                audiobookId: row.audiobook_id,
                type: 'ebook',
                parentRequestId: row.parent_request_id,
                status: 'pending',
                progress: 0,
                customSearchTerms: row.custom_search_terms,
                ebookAutoRetryCount: 1,
              },
            });
            ebookRequestId = createdRow.id;
            action = 'created';
            return;
          }

          const status = row.ebook_status;
          if (status === 'downloaded') {
            action = 'skipped-has-companion';
            return;
          }
          if (status && IN_FLIGHT_STATUSES.has(status)) {
            action = 'skipped-in-flight';
            return;
          }
          if (status === 'cancelled') {
            action = 'skipped-cancelled';
            return;
          }
          if (status === 'failed' || status === 'warn') {
            const current = row.ebook_auto_retry_count ?? 0;
            if (current >= AUTO_RETRY_CAP) {
              action = 'skipped-cap';
              return;
            }
            await tx.request.update({
              where: { id: row.ebook_request_id! },
              data: {
                status: 'pending',
                progress: 0,
                errorMessage: null,
                ebookAutoRetryCount: current + 1,
              },
            });
            action = 'retried';
            return;
          }
          // Defensive — unrecognized status (e.g. denied, awaiting_import on an
          // ebook child that crossed wires). Leave it alone; surface via log.
          action = 'skipped-unknown';
        });

        if (action === 'created' || action === 'retried') {
          gapsFound++;
          try {
            await jobQueue.addSearchEbookJob(ebookRequestId!, {
              id: row.audiobook_id,
              title: row.audiobook_title,
              author: row.audiobook_author,
              asin: row.audible_asin || undefined,
            });
            if (action === 'created') created++;
            else retried++;
          } catch (enqueueErr) {
            // Roll counter back on enqueue failure so the cap reflects only
            // successful auto-retries. Per engineering brief: "increment only
            // when queue add succeeds." Failure to decrement is logged but
            // swallowed — primary error is the one that matters.
            await prisma.request.update({
              where: { id: ebookRequestId! },
              data: { ebookAutoRetryCount: { decrement: 1 } },
            }).catch((rollbackErr) => {
              logger.error(`Failed to roll back counter for ebook ${ebookRequestId}: ${rollbackErr instanceof Error ? rollbackErr.message : 'Unknown error'}`);
            });
            throw enqueueErr;
          }
        } else if (action === 'skipped-in-flight') skippedInFlight++;
        else if (action === 'skipped-cancelled') skippedCancelled++;
        else if (action === 'skipped-cap') skippedCapHit++;

        logger.info('find_missing_ebooks iteration', {
          audiobookId: row.audiobook_id,
          parentRequestId: row.parent_request_id,
          ebookRequestId,
          action,
        });
      } catch (err) {
        logger.error(`Failed candidate ${row.parent_request_id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }

      // Spread DB operations over time to avoid connection pool exhaustion.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const triggered = created + retried;
    logger.info('find_missing_ebooks pass complete', {
      scanned,
      gapsFound,
      triggered,
      created,
      retried,
      skippedInFlight,
      skippedCancelled,
      skippedCapHit,
    });

    return {
      success: true,
      message: 'find_missing_ebooks completed',
      scanned,
      gapsFound,
      triggered,
      created,
      retried,
      skippedInFlight,
      skippedCancelled,
      skippedCapHit,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
