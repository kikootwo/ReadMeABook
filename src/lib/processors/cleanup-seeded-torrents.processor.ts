/**
 * Component: Cleanup Seeded Torrents Processor
 * Documentation: documentation/backend/services/scheduler.md
 *
 * Cleans up torrents that have met their seeding requirements
 */

import { prisma } from '../db';
import { createJobLogger } from '../utils/job-logger';

export interface CleanupSeededTorrentsPayload {
  jobId?: string;
  scheduledJobId?: string;
}

export async function processCleanupSeededTorrents(payload: CleanupSeededTorrentsPayload): Promise<any> {
  const { jobId, scheduledJobId } = payload;
  const logger = jobId ? createJobLogger(jobId, 'CleanupSeededTorrents') : null;

  await logger?.info('Starting cleanup job for seeded torrents...');

  try {
    // Get indexer configuration with per-indexer seeding times
    const { getConfigService } = await import('../services/config.service');
    const configService = getConfigService();
    const indexersConfigStr = await configService.get('prowlarr_indexers');

    if (!indexersConfigStr) {
      await logger?.warn('No indexer configuration found, skipping');
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

    await logger?.info(`Loaded configuration for ${indexerConfigMap.size} indexers`);

    // Find all completed requests that have download history
    const completedRequests = await prisma.request.findMany({
      where: {
        status: { in: ['available', 'downloaded'] },
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

    await logger?.info(`Found ${completedRequests.length} completed requests to check`);

    let cleaned = 0;
    let skipped = 0;
    let noConfig = 0;

    for (const request of completedRequests) {
      try {
        const downloadHistory = request.downloadHistory[0];

        if (!downloadHistory || !downloadHistory.downloadClientId || !downloadHistory.indexerName) {
          continue;
        }

        // Get the indexer name from download history
        const indexerName = downloadHistory.indexerName;

        // Find matching indexer configuration by name
        const seedingConfig = indexerConfigMap.get(indexerName);

        // If no config found or seeding time is 0 (unlimited), skip
        if (!seedingConfig) {
          noConfig++;
          continue;
        }

        if (seedingConfig.seedingTimeMinutes === 0) {
          noConfig++;
          continue;
        }

        const seedingTimeSeconds = seedingConfig.seedingTimeMinutes * 60;

        // Get torrent info from qBittorrent to check seeding time
        const { getQBittorrentService } = await import('../integrations/qbittorrent.service');
        const qbt = await getQBittorrentService();

        let torrent;
        try {
          torrent = await qbt.getTorrent(downloadHistory.downloadClientId);
        } catch (error) {
          // Torrent might already be deleted, skip
          continue;
        }

        // Check if seeding time requirement is met
        const actualSeedingTime = torrent.seeding_time || 0;
        const hasMetRequirement = actualSeedingTime >= seedingTimeSeconds;

        if (!hasMetRequirement) {
          const remaining = Math.ceil((seedingTimeSeconds - actualSeedingTime) / 60);
          skipped++;
          continue;
        }

        await logger?.info(`Torrent ${torrent.name} (${indexerName}) has met seeding requirement (${Math.floor(actualSeedingTime / 60)}/${seedingConfig.seedingTimeMinutes} minutes)`);

        // Delete torrent and files from qBittorrent
        await qbt.deleteTorrent(downloadHistory.downloadClientId, true); // true = delete files

        await logger?.info(`Deleted torrent and files for request ${request.id}`);
        cleaned++;
      } catch (error) {
        await logger?.error(`Failed to cleanup request ${request.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    await logger?.info(`Cleanup complete: ${cleaned} torrents cleaned, ${skipped} still seeding, ${noConfig} unlimited`);

    return {
      success: true,
      message: 'Cleanup seeded torrents completed',
      totalChecked: completedRequests.length,
      cleaned,
      skipped,
      unlimited: noConfig,
    };
  } catch (error) {
    await logger?.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    throw error;
  }
}
