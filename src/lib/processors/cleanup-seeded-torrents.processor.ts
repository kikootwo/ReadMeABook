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

    if (!indexersConfigStr) {
      logger.warn('No indexer configuration found, skipping');
      return {
        success: false,
        message: 'No indexer configuration',
        skipped: true,
      };
    }

    const indexersConfig = JSON.parse(indexersConfigStr);

    // Create a map of indexer name to config for quick lookup
    const indexerConfigMap = new Map<string, any>();
    for (const indexer of indexersConfig) {
      indexerConfigMap.set(indexer.name, indexer);
    }

    logger.info(`Loaded configuration for ${indexerConfigMap.size} indexers`);

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

        // Get the indexer name from download history
        const indexerName = downloadHistory.indexerName;

        // Find matching indexer configuration by name
        const seedingConfig = indexerConfigMap.get(indexerName);

        // Per-indexer thresholds. 0 disables that criterion; both 0 = unlimited.
        const seedingMin: number = seedingConfig?.seedingTimeMinutes ?? 0;
        const ratioMin: number = seedingConfig?.ratioLimit ?? 0;

        // If no config found or both criteria are 0 (unlimited)
        if (!seedingConfig || (seedingMin === 0 && ratioMin === 0)) {
          // For soft-deleted requests with unlimited seeding, hard delete immediately
          if (request.deletedAt) {
            await prisma.request.delete({ where: { id: request.id } });
            logger.info(`Hard-deleted orphaned request ${request.id} with unlimited seeding`);
          }
          noConfig++;
          continue;
        }

        const seedingTimeSeconds = seedingMin * 60;

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

        // Check seeding requirements: AND-semantics across time and ratio.
        // Each criterion is "met" when disabled (0) or when actual meets/exceeds it.
        // Undefined ratio with ratioMin > 0 is treated as not-met (safe-deny).
        const actualSeedingTime = downloadInfo.seedingTime ?? 0;
        const actualRatio = downloadInfo.ratio;
        const timeMet = seedingMin === 0 || actualSeedingTime >= seedingTimeSeconds;
        const ratioMet = ratioMin === 0 || (typeof actualRatio === 'number' && actualRatio >= ratioMin);
        const hasMetRequirement = timeMet && ratioMet;

        const ratioPart = ratioMin === 0
          ? '--/--'
          : `${(typeof actualRatio === 'number' ? actualRatio : 0).toFixed(2)}/${ratioMin.toFixed(2)}`;
        const timePart = seedingMin === 0
          ? '--/--'
          : `${Math.floor(actualSeedingTime / 60)}/${seedingMin}`;
        const progress = `ratio ${ratioPart}, time ${timePart} min`;

        if (!hasMetRequirement) {
          logger.debug(`Download ${downloadInfo.name} (${indexerName}) still seeding: ${progress}`);
          skipped++;
          continue;
        }

        logger.info(`Download ${downloadInfo.name} (${indexerName}) has met seeding requirement: ${progress}`);

        // CRITICAL: Check if any other active (non-deleted) request is using this same download
        const hashToCheck = downloadHistory.torrentHash;
        if (hashToCheck) {
          const otherActiveRequests = await prisma.request.findMany({
            where: {
              id: { not: request.id }, // Exclude current request
              deletedAt: null, // Only check active requests
              downloadHistory: {
                some: {
                  torrentHash: hashToCheck,
                  selected: true,
                },
              },
            },
            select: { id: true, status: true },
          });

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
