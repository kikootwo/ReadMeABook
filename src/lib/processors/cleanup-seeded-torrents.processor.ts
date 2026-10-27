/**
 * Component: Cleanup Seeded Torrents Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Cleans up downloads that have met their seeding requirements.
 * Uses the IDownloadClient interface for client-agnostic operation.
 * Checks every candidate (keyset pages of 100), removes only torrents RMAB added,
 * and marks a row 'removed' once its torrent is definitely gone from the client.
 */

import type { Prisma } from '@/generated/prisma';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { CLIENT_PROTOCOL_MAP, DownloadClientType, IDownloadClient } from '../interfaces/download-client.interface';
import { evaluateSeeding, isUnlimitedSeeding } from '../utils/seeding-policy';
import { FINISHED_REQUESTS, otherActiveRequestsSharingTorrent, otherActiveRequestsUsingTorrent, siblingKeepsTorrent } from '../utils/shared-torrent';
import { createIndexerConfigLookup, describeIgnoredIndexerId, parseSavedIndexers } from '../utils/indexer-config';
import { knownNotOwned, resolveOwnership } from '../utils/torrent-ownership';

export interface CleanupSeededTorrentsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

/** Requests per page. Keyset paging (id > last), never Prisma `cursor:`: this loop hard-deletes rows */
export const CLEANUP_PAGE_SIZE = 100;
const MAX_PROBE_ERRORS_IN_A_ROW = 3;

// Completed requests + soft-deleted requests (orphaned downloads), each with a finished selected download.
// IMPORTANT: Only cleanup requests that are truly complete and not being actively processed.
// NOTE: Multiple requests can share the same torrent hash (e.g., re-requesting same audiobook, a series pack);
// a torrent is deleted only when every other active request using it is finished and done seeding too (#283).
// NOTE: Ebooks downloaded via indexer search use torrent clients and need seeding cleanup too.
//       Direct HTTP ebook downloads are naturally skipped (no torrent hash / unknown client type).
const CANDIDATES = {
  OR: [
    // Finished: audiobook available (matched in Plex/ABS), ebook downloaded (terminal state for ebooks)
    ...FINISHED_REQUESTS.map((finished) => ({ ...finished, deletedAt: null })),
    // Soft-deleted requests of any type (orphaned downloads)
    { deletedAt: { not: null } },
  ],
};
// Rows marked 'removed' (gone from the client) are no longer 'completed', so they drop out here
const HAS_FINISHED_DOWNLOAD = { downloadHistory: { some: { selected: true, downloadStatus: 'completed' } } };

type CandidateRequest = Prisma.RequestGetPayload<{ include: { downloadHistory: true } }>;
type Outcome = 'cleaned' | 'seeding' | 'unlimited' | 'notOwned' | 'missing' | 'errors' | 'otherClient' | 'none';

export async function processCleanupSeededTorrents(payload: CleanupSeededTorrentsPayload): Promise<any> {
  const { jobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'CleanupSeededTorrents');

  logger.info('Starting cleanup job for seeded torrents...');

  try {
    // Get indexer configuration with per-indexer seeding times
    const { getConfigService } = await import('../services/config.service');
    const { getDownloadClientManager } = await import('../services/download-client-manager.service');
    const configService = getConfigService();
    const manager = getDownloadClientManager(configService);
    const indexersConfigStr = await configService.get('prowlarr_indexers');

    const indexersConfig = parseSavedIndexers(indexersConfigStr);
    if (!indexersConfig) {
      // Missing or unreadable: change nothing (treating every indexer as unconfigured would mean
      // "seed forever" and hard-delete soft-deleted requests whose torrents are still in the client)
      logger.warn(indexersConfigStr ? 'Indexer configuration is not a JSON list, skipping' : 'No indexer configuration found, skipping');
      return {
        success: false,
        message: indexersConfigStr ? 'Invalid indexer configuration' : 'No indexer configuration',
        skipped: true,
      };
    }

    // Look up each download's indexer by Prowlarr id (survives renames) unless it now means another
    // indexer, else by name
    const lookupIndexer = createIndexerConfigLookup<any>(indexersConfig as any[]);
    const matchCounts = { id: 0, name: 0, none: 0, idIgnored: 0 };

    logger.info(`Loaded configuration for ${indexersConfig.length} indexers`);

    const counts: Record<Outcome, number> = {
      cleaned: 0, seeding: 0, unlimited: 0, notOwned: 0, missing: 0, errors: 0, otherClient: 0, none: 0,
    };
    const deletedHashes = new Set<string>(); // Track torrents already deleted this run
    let pages = 0;
    let checked = 0;
    let lastId: string | undefined;
    // A client that does not answer costs a timeout per candidate: stop after a few in a row
    let probeErrorsInARow = 0;
    let stoppedEarly = false;

    const markRemoved = (downloadHistoryId: string) =>
      prisma.downloadHistory.update({ where: { id: downloadHistoryId }, data: { downloadStatus: 'removed' } });

    const cleanUpRequest = async (request: CandidateRequest): Promise<Outcome> => {
      const downloadHistory = request.downloadHistory[0];

      if (!downloadHistory || !downloadHistory.indexerName) {
        return 'none';
      }

      // Skip Usenet downloads - no seeding concept
      if (downloadHistory.nzbId && !downloadHistory.torrentHash) {
        // For soft-deleted Usenet requests, hard delete immediately (no seeding needed)
        if (request.deletedAt) {
          await prisma.request.delete({ where: { id: request.id } });
          logger.info(`Hard-deleted orphaned Usenet request ${request.id}`);
        }
        return 'none';
      }

      // Only process downloads that have a client ID
      if (!downloadHistory.downloadClientId && !downloadHistory.torrentHash) {
        return 'none';
      }

      // Determine the download client ID and protocol
      const clientId: string = downloadHistory.downloadClientId || downloadHistory.torrentHash!;
      const clientType = downloadHistory.downloadClient || 'qbittorrent';
      const protocol = CLIENT_PROTOCOL_MAP[clientType as DownloadClientType];
      if (!protocol) {
        logger.warn(`Unknown download client type: ${clientType}, skipping`);
        return 'none';
      }

      // A torrent RMAB did not add is never removed: stop tracking it, no client call
      const known = knownNotOwned(downloadHistory);
      if (known && !known.owned) {
        if (request.deletedAt) {
          await prisma.request.delete({ where: { id: request.id } });
          logger.info(`Hard-deleted orphaned request ${request.id}; its torrent ${clientId} stays in ${clientType}: ${known.detail}`);
        } else {
          logger.debug(`Leaving ${clientId} in ${clientType}: ${known.detail}`);
        }
        return 'notOwned';
      }

      const indexerName = downloadHistory.indexerName;
      const indexerRef = { indexerId: downloadHistory.indexerId, indexerName, protocol };
      const match = lookupIndexer(indexerRef);
      const { config: seedingConfig, matchedBy } = match;
      matchCounts[matchedBy ?? 'none']++;
      const ignoredId = describeIgnoredIndexerId(indexerRef, match);
      if (ignoredId) {
        matchCounts.idIgnored++;
        logger.debug(ignoredId);
      }
      logger.debug(
        matchedBy
          ? `Indexer config for ${indexerName} (id ${downloadHistory.indexerId ?? 'none'}) matched by ${matchedBy}`
          : `No indexer config for ${indexerName} (id ${downloadHistory.indexerId ?? 'none'}): treated as unlimited`
      );

      // Per-indexer thresholds. 0 disables that criterion; no config or both 0 = unlimited.
      if (isUnlimitedSeeding(seedingConfig)) {
        // For soft-deleted requests with unlimited seeding, hard delete immediately
        if (request.deletedAt) {
          await prisma.request.delete({ where: { id: request.id } });
          logger.info(`Hard-deleted orphaned request ${request.id} with unlimited seeding`);
        }
        return 'unlimited';
      }

      // Get download info from the appropriate client via the interface
      const client: IDownloadClient | null = await manager.getClientServiceForProtocol(protocol as 'torrent' | 'usenet');

      if (!client) {
        logger.warn(`No ${clientType} client configured, skipping request ${request.id}`);
        return 'seeding';
      }

      if (client.clientType !== clientType) {
        // Another client is configured now: don't ask it about (or remove, or mark) this id.
        // One warn per run with the count (below); per download at debug
        logger.debug(`Download ${clientId} was recorded for ${clientType}, but ${client.clientType} is configured: skipped`);
        return 'otherClient';
      }

      // Skip if this torrent was already deleted earlier in this run (same client type)
      if (deletedHashes.has(clientId.toLowerCase())) {
        if (request.deletedAt) {
          await prisma.request.delete({ where: { id: request.id } });
          logger.info(`Hard-deleted orphaned request ${request.id} (torrent already cleaned this run)`);
        } else {
          await markRemoved(downloadHistory.id);
        }
        return 'cleaned';
      }

      // Strict probe: one request, no retries. Only a well-formed answer without the torrent is "gone"
      let probe;
      try {
        if (!client.probeDownload) throw new Error(`${client.clientType} has no strict lookup`);
        probe = await client.probeDownload(clientId);
        probeErrorsInARow = 0;
      } catch (error) {
        probeErrorsInARow++;
        logger.warn(`Could not check ${clientId} in ${clientType}, nothing changed: ${error instanceof Error ? error.message : String(error)}`);
        return 'errors';
      }

      if (!probe.found) {
        // Definitely gone: stop re-checking it. A soft-deleted request only gets the marker (reversible)
        await markRemoved(downloadHistory.id);
        logger.info(`Download ${clientId} is no longer in ${clientType}: marked removed`);
        return 'missing';
      }
      const downloadInfo = probe.info;

      // Only a torrent RMAB added is ever removed (legacy rows: from the client's added time)
      const ownership = resolveOwnership(downloadHistory, downloadInfo.addedAt);
      if (!ownership.owned) {
        logger.info(`Leaving ${downloadInfo.name} in ${clientType}: ${ownership.detail}`);
        if (ownership.recordNotOwned) {
          if (request.deletedAt) {
            await prisma.request.delete({ where: { id: request.id } });
            logger.info(`Hard-deleted orphaned request ${request.id} (kept a torrent RMAB did not add)`);
          } else {
            await prisma.downloadHistory.update({ where: { id: downloadHistory.id }, data: { addedByRmab: false } });
          }
        }
        return 'notOwned';
      }

      // AND-semantics across time and ratio; unreported ratio with a ratio limit = not met
      const { met: hasMetRequirement, progress } = evaluateSeeding(seedingConfig, downloadInfo);

      if (!hasMetRequirement) {
        logger.debug(`Download ${downloadInfo.name} (${indexerName}) still seeding: ${progress}`);
        return 'seeding';
      }

      logger.info(`Download ${downloadInfo.name} (${indexerName}) has met seeding requirement: ${progress}`);

      // CRITICAL: every other active (non-deleted) request using this download must be finished, and
      // done seeding by its own indexer's rule (same client answer); any other one keeps it
      const siblings = await otherActiveRequestsSharingTorrent(request.id, downloadHistory.torrentHash);
      const keeping = siblings.flatMap((sibling) => {
        const reason = siblingKeepsTorrent(sibling, clientType, (row) => evaluateSeeding(
          lookupIndexer({ indexerId: row.indexerId, indexerName: row.indexerName ?? '', protocol }).config, downloadInfo
        ));
        return reason ? [`${sibling.id} (${reason})`] : [];
      });
      if (keeping.length > 0) {
        logger.info(`Skipping download deletion - ${keeping.length} other active request(s) still using this download: ${keeping.join(', ')}`);

        // If this is a soft-deleted request, hard delete it but DON'T delete the download
        if (request.deletedAt) {
          await prisma.request.delete({ where: { id: request.id } });
          logger.info(`Hard-deleted orphaned request ${request.id} (kept shared download for active requests)`);
        }

        return 'seeding';
      }

      // Safe to delete - no other active request needs this download
      await client.deleteDownload(clientId, true); // true = delete files
      deletedHashes.add(clientId.toLowerCase());
      if (siblings.length > 0) {
        // Their rows say the torrent is gone too (a row RMAB did not add never gets here on its own)
        const siblingRowIds = siblings.flatMap((sibling) => sibling.downloadHistory.map((row) => row.id));
        await prisma.downloadHistory.updateMany({ where: { id: { in: siblingRowIds } }, data: { downloadStatus: 'removed' } });
        logger.info(`Download was shared with ${siblings.length} finished request(s) (${siblings.map((s) => s.id).join(', ')}): marked removed for them too`);
      }

      // If this is a soft-deleted request (orphaned download), hard delete it now
      if (request.deletedAt) {
        await prisma.request.delete({ where: { id: request.id } });
        logger.info(`Hard-deleted orphaned request ${request.id} after download cleanup`);
      } else {
        await markRemoved(downloadHistory.id);
        logger.info(`Deleted download and files for active request ${request.id}`);
      }

      return 'cleaned';
    };

    const cleanUpCancelledRequest = async (request: CandidateRequest): Promise<Outcome> => {
      const row = request.downloadHistory[0];
      if (!row) return 'none';
      if (row.nzbId && !row.torrentHash) return 'none'; // Usenet: nothing seeding in a torrent client

      const clientId = row.downloadClientId || row.torrentHash;
      const clientType = row.downloadClient;
      if (!clientId || !clientType) return 'none';
      if (CLIENT_PROTOCOL_MAP[clientType as DownloadClientType] !== 'torrent') return 'none';

      // A torrent RMAB did not add is never removed
      const known = knownNotOwned(row);
      if (known && !known.owned) {
        logger.debug(`Leaving ${clientId} of cancelled request ${request.id} in ${clientType}: ${known.detail}`);
        return 'notOwned';
      }

      // Another live request still using this torrent keeps it (cancelled/failed ones don't count)
      const others = (await otherActiveRequestsUsingTorrent(request.id, row.torrentHash))
        .filter((r) => r.status !== 'cancelled' && r.status !== 'failed');
      if (others.length > 0) return 'seeding';

      const client: IDownloadClient | null = await manager.getClientServiceForProtocol('torrent');
      if (!client || client.clientType !== clientType) return 'otherClient';

      if (deletedHashes.has(clientId.toLowerCase())) {
        await markRemoved(row.id);
        return 'cleaned';
      }

      let probe;
      try {
        if (!client.probeDownload) throw new Error(`${client.clientType} has no strict lookup`);
        probe = await client.probeDownload(clientId);
        probeErrorsInARow = 0;
      } catch (error) {
        probeErrorsInARow++;
        logger.warn(`Could not check ${clientId} in ${clientType}, nothing changed: ${error instanceof Error ? error.message : String(error)}`);
        return 'errors';
      }

      if (!probe.found) {
        await markRemoved(row.id);
        logger.info(`Download ${clientId} of cancelled request ${request.id} is no longer in ${clientType}: marked removed`);
        return 'missing';
      }

      const ownership = resolveOwnership(row, probe.info.addedAt);
      if (!ownership.owned) {
        logger.info(`Leaving ${probe.info.name} in ${clientType}: ${ownership.detail}`);
        if (ownership.recordNotOwned) {
          await prisma.downloadHistory.update({ where: { id: row.id }, data: { addedByRmab: false } });
        }
        return 'notOwned';
      }

      await client.deleteDownload(clientId, true); // true = delete files
      deletedHashes.add(clientId.toLowerCase());
      await markRemoved(row.id);
      logger.info(`Removed cancelled request ${request.id} download ${probe.info.name} from ${clientType}`);
      return 'cleaned';
    };

    for (;;) {
      const page = await prisma.request.findMany({
        where: { AND: [CANDIDATES, HAS_FINISHED_DOWNLOAD, ...(lastId ? [{ id: { gt: lastId } }] : [])] },
        include: {
          downloadHistory: {
            where: {
              selected: true,
              downloadStatus: 'completed',
            },
            orderBy: { completedAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { id: 'asc' },
        take: CLEANUP_PAGE_SIZE,
      });
      pages++;
      checked += page.length;

      for (const request of page) {
        try {
          counts[await cleanUpRequest(request)]++;
        } catch (error) {
          // Idempotent steps: a torrent already gone or a request already hard-deleted (overlapping run) lands here
          counts.errors++;
          logger.error(`Failed to cleanup request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        if (probeErrorsInARow >= MAX_PROBE_ERRORS_IN_A_ROW) {
          stoppedEarly = true;
          break;
        }
      }

      if (stoppedEarly) {
        logger.warn(
          `Stopped after ${probeErrorsInARow} downloads in a row could not be checked in the download client `
          + `(${checked} candidate(s) read so far); nothing was changed for them. The next scheduled run tries again`
        );
        break;
      }
      if (page.length < CLEANUP_PAGE_SIZE) break;
      lastId = page[page.length - 1].id;
    }

    // Cancelled requests: cancelling only flips the request status; nothing told the download client to
    // drop the torrent. Remove it (and its partial data) under the same ownership rule as everything else.
    if (!stoppedEarly) {
      try {
        const cancelled = await prisma.request.findMany({
          where: {
            status: 'cancelled',
            deletedAt: null,
            downloadHistory: { some: { selected: true, downloadStatus: { not: 'removed' } } },
          },
          include: {
            downloadHistory: {
              where: { selected: true, downloadStatus: { not: 'removed' } },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: 200,
        });

        for (const request of cancelled) {
          try {
            const outcome = await cleanUpCancelledRequest(request);
            if (outcome !== 'none') {
              counts[outcome]++;
            }
          } catch (error) {
            counts.errors++;
            logger.error(`Failed to clean cancelled request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          if (probeErrorsInARow >= MAX_PROBE_ERRORS_IN_A_ROW) {
            logger.warn('Stopped the cancelled-request pass: the download client is not answering');
            break;
          }
        }
      } catch (error) {
        // Additive pass: never let it fail the seeding cleanup above
        counts.errors++;
        logger.error(`Cancelled-request cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    logger.info(`Indexer config matches: ${matchCounts.id} by id, ${matchCounts.name} by name, ${matchCounts.none} not configured`);
    if (counts.otherClient > 0) {
      logger.warn(`${counts.otherClient} download(s) were recorded for another client type than the one configured now: left as they are`);
    }
    if (matchCounts.idIgnored > 0) {
      logger.warn(
        `${matchCounts.idIgnored} download(s) recorded a Prowlarr indexer id that now belongs to another indexer `
        + '(Prowlarr ids are reused after a rebuild); their settings were looked up by name instead (details at debug level)'
      );
    }
    logger.info(
      `Cleanup complete: ${pages} page(s), ${checked} checked, ${counts.cleaned} cleaned, ${counts.seeding} still seeding, `
      + `${counts.unlimited} unlimited, ${counts.notOwned} not added by RMAB (kept), ${counts.missing} gone from the client, `
      + `${counts.errors} errors${counts.otherClient ? `, ${counts.otherClient} recorded for another client` : ''}`
    );

    return {
      success: true,
      message: 'Cleanup seeded torrents completed',
      totalChecked: checked,
      pages,
      cleaned: counts.cleaned,
      skipped: counts.seeding,
      unlimited: counts.unlimited,
      notOwned: counts.notOwned,
      missing: counts.missing,
      errors: counts.errors,
      otherClient: counts.otherClient,
      stoppedEarly,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
