/**
 * Component: Cleanup Seeded Torrents Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Cleans up downloads that have met their seeding requirements.
 * Uses the IDownloadClient interface for client-agnostic operation.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { CLIENT_PROTOCOL_MAP, DownloadClientType } from '../interfaces/download-client.interface';
import { evaluateSeeding, isUnlimitedSeeding } from '../utils/seeding-policy';
import { otherActiveRequestsUsingTorrent } from '../utils/shared-torrent';
import { createIndexerConfigLookup, describeIgnoredIndexerId, parseSavedIndexers } from '../utils/indexer-config';

export interface CleanupSeededTorrentsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processCleanupSeededTorrents(payload: CleanupSeededTorrentsPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
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

    // Find all completed requests + soft-deleted requests (orphaned downloads)
    // IMPORTANT: Only cleanup requests that are truly complete and not being actively processed
    // NOTE: Multiple requests can share the same torrent hash (e.g., re-requesting same audiobook)
    // Before deleting torrent, we check if other active requests are using it
    // NOTE: Ebooks downloaded via indexer search use torrent clients and need seeding cleanup too.
    //       Direct HTTP ebook downloads are naturally skipped (no torrent hash / unknown client type).
    const completedRequests = await prisma.request.findMany({
      where: {
        OR: [
          // Audiobook requests that are fully available (matched in Plex/ABS)
          {
            type: 'audiobook',
            status: 'available',
            deletedAt: null,
          },
          // Ebook requests that are fully downloaded (terminal state for ebooks)
          {
            type: 'ebook',
            status: 'downloaded',
            deletedAt: null,
          },
          // Soft-deleted requests of any type (orphaned downloads)
          {
            deletedAt: { not: null },
          },
        ],
      },
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
      take: 100, // Limit to 100 requests per run
    });

    logger.info(`Found ${completedRequests.length} requests to check (audiobook: available, ebook: downloaded, or soft-deleted)`);

    let cleaned = 0;
    let skipped = 0;
    let noConfig = 0;
    const deletedHashes = new Set<string>(); // Track torrents already deleted this run

    for (const request of completedRequests) {
      try {
        const downloadHistory = request.downloadHistory[0];

        if (!downloadHistory || !downloadHistory.indexerName) {
          continue;
        }

        // Skip Usenet downloads - no seeding concept
        if (downloadHistory.nzbId && !downloadHistory.torrentHash) {
          // For soft-deleted Usenet requests, hard delete immediately (no seeding needed)
          if (request.deletedAt) {
            await prisma.request.delete({ where: { id: request.id } });
            logger.info(`Hard-deleted orphaned Usenet request ${request.id}`);
          }
          continue;
        }

        // Only process downloads that have a client ID
        if (!downloadHistory.downloadClientId && !downloadHistory.torrentHash) {
          continue;
        }

        // Determine the download client ID and protocol
        const clientId = downloadHistory.downloadClientId || downloadHistory.torrentHash!;
        const clientType = downloadHistory.downloadClient || 'qbittorrent';
        const protocol = CLIENT_PROTOCOL_MAP[clientType as DownloadClientType];
        if (!protocol) {
          logger.warn(`Unknown download client type: ${clientType}, skipping`);
          continue;
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
          noConfig++;
          continue;
        }

        // Skip if this torrent was already deleted earlier in this run
        if (deletedHashes.has(clientId.toLowerCase())) {
          if (request.deletedAt) {
            await prisma.request.delete({ where: { id: request.id } });
            logger.info(`Hard-deleted orphaned request ${request.id} (torrent already cleaned this run)`);
          }
          cleaned++;
          continue;
        }

        // Get download info from the appropriate client via the interface
        const client = await manager.getClientServiceForProtocol(protocol as 'torrent' | 'usenet');

        if (!client) {
          logger.warn(`No ${clientType} client configured, skipping request ${request.id}`);
          skipped++;
          continue;
        }

        let downloadInfo;
        try {
          downloadInfo = await client.getDownload(clientId);
        } catch (error) {
          // Download not found in client (already removed), skip
          continue;
        }

        if (!downloadInfo) {
          // Download not found in client (already removed)
          continue;
        }

        // AND-semantics across time and ratio; unreported ratio with a ratio limit = not met
        const { met: hasMetRequirement, progress } = evaluateSeeding(seedingConfig, downloadInfo);

        if (!hasMetRequirement) {
          logger.debug(`Download ${downloadInfo.name} (${indexerName}) still seeding: ${progress}`);
          skipped++;
          continue;
        }

        logger.info(`Download ${downloadInfo.name} (${indexerName}) has met seeding requirement: ${progress}`);

        // CRITICAL: Check if any other active (non-deleted) request is using this same download
        const otherActiveRequests = await otherActiveRequestsUsingTorrent(request.id, downloadHistory.torrentHash);
        if (otherActiveRequests.length > 0) {
          logger.info(`Skipping download deletion - ${otherActiveRequests.length} other active request(s) still using this download (IDs: ${otherActiveRequests.map(r => r.id).join(', ')})`);

          // If this is a soft-deleted request, hard delete it but DON'T delete the download
          if (request.deletedAt) {
            await prisma.request.delete({ where: { id: request.id } });
            logger.info(`Hard-deleted orphaned request ${request.id} (kept shared download for active requests)`);
          }

          skipped++;
          continue;
        }

        // Safe to delete - no other active requests using this download
        await client.deleteDownload(clientId, true); // true = delete files
        deletedHashes.add(clientId.toLowerCase());

        // If this is a soft-deleted request (orphaned download), hard delete it now
        if (request.deletedAt) {
          await prisma.request.delete({ where: { id: request.id } });
          logger.info(`Hard-deleted orphaned request ${request.id} after download cleanup`);
        } else {
          logger.info(`Deleted download and files for active request ${request.id}`);
        }

        cleaned++;
      } catch (error) {
        logger.error(`Failed to cleanup request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    logger.info(`Indexer config matches: ${matchCounts.id} by id, ${matchCounts.name} by name, ${matchCounts.none} not configured`);
    if (matchCounts.idIgnored > 0) {
      logger.warn(
        `${matchCounts.idIgnored} download(s) recorded a Prowlarr indexer id that now belongs to another indexer `
        + '(Prowlarr ids are reused after a rebuild); their settings were looked up by name instead (details at debug level)'
      );
    }
    logger.info(`Cleanup complete: ${cleaned} downloads cleaned, ${skipped} still seeding, ${noConfig} unlimited`);

    return {
      success: true,
      message: 'Cleanup seeded torrents completed',
      totalChecked: completedRequests.length,
      cleaned,
      skipped,
      unlimited: noConfig,
    };
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
