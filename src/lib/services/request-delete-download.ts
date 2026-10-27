/**
 * Component: Request Deletion - Download Handling
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * What a request delete does with the request's download in its client: remove it,
 * keep it seeding, or leave it alone (shared, unlimited, or not RMAB's torrent).
 */

import type { DownloadHistory } from '@/generated/prisma';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { CLIENT_PROTOCOL_MAP, DownloadClientType } from '../interfaces/download-client.interface';
import { evaluateSeeding, type SeedingRequirement } from '../utils/seeding-policy';
import { otherActiveRequestsUsingNzb, otherActiveRequestsUsingTorrent } from '../utils/shared-torrent';
import { describeIgnoredIndexerId, findIndexerConfig, parseSavedIndexers, type SavedIndexerConfig } from '../utils/indexer-config';
import { knownNotOwned, resolveOwnership, type OwnershipVerdict } from '../utils/torrent-ownership';

const logger = RMABLogger.create('RequestDelete');

export interface DownloadCleanupCounts {
  torrentsRemoved: number;
  torrentsKeptSeeding: number;
  torrentsKeptUnlimited: number;
  /** Torrents left in the client because another active request still uses them. */
  torrentsKeptShared: number;
  /** Torrents left in the client because RMAB did not add them (or can't tell that it did). */
  torrentsKeptNotOwned: number;
}

export function emptyDownloadCleanupCounts(): DownloadCleanupCounts {
  return { torrentsRemoved: 0, torrentsKeptSeeding: 0, torrentsKeptUnlimited: 0, torrentsKeptShared: 0, torrentsKeptNotOwned: 0 };
}

/** Leave a torrent RMAB did not add exactly as it is; on a clear legacy verdict, record that. */
async function keepNotOwned(
  row: DownloadHistory,
  verdict: Extract<OwnershipVerdict, { owned: false }>,
  clientName: string,
  counts: DownloadCleanupCounts
): Promise<void> {
  const id = row.downloadClientId || row.torrentHash;
  if (verdict.reason === 'removed') {
    logger.info(`Download ${id}: ${verdict.detail}; nothing removed from ${clientName}`);
    return;
  }
  logger.info(`Download ${id} left in ${clientName}: ${verdict.detail}`);
  counts.torrentsKeptNotOwned++;
  if (verdict.recordNotOwned) {
    await prisma.downloadHistory.update({ where: { id: row.id }, data: { addedByRmab: false } });
  }
}

/**
 * Handle the request's selected download. Never throws: a failure is logged and the
 * delete continues (the download is then left in the client).
 */
export async function cleanUpRequestDownload(
  requestId: string,
  downloadHistory: DownloadHistory
): Promise<DownloadCleanupCounts> {
  const counts = emptyDownloadCleanupCounts();
  try {
    // Get indexer seeding configuration
    const { getConfigService } = await import('./config.service');
    const configService = getConfigService();
    const indexersConfigStr = await configService.get('prowlarr_indexers');

    // Handle download cleanup via unified interface
    const clientId = downloadHistory.downloadClientId || downloadHistory.torrentHash || downloadHistory.nzbId;
    const clientType = downloadHistory.downloadClient || 'qbittorrent';

    let seedingConfig: SeedingRequirement | null = null;
    if (indexersConfigStr) {
      const indexersConfig = parseSavedIndexers(indexersConfigStr);
      if (!indexersConfig) {
        // Unreadable settings: leave the download alone (handled by the catch below)
        throw new Error('Saved indexer configuration is not a list; the download was left in the client');
      }
      // By Prowlarr id (survives renames) unless it now means another indexer; else by name
      const ref = {
        indexerId: downloadHistory.indexerId,
        indexerName: downloadHistory.indexerName,
        protocol: CLIENT_PROTOCOL_MAP[clientType as DownloadClientType] || 'torrent',
      };
      const match = findIndexerConfig(indexersConfig as SavedIndexerConfig[], ref);
      seedingConfig = match.config ?? null;
      const ignored = describeIgnoredIndexerId(ref, match);
      if (ignored) logger.warn(ignored);
      logger.debug(`Indexer config for ${downloadHistory.indexerName}: ${match.matchedBy ? `matched by ${match.matchedBy}` : 'not configured'}`);
    }

    if (!clientId || clientType === 'direct') return counts;

    // Taken over, or already recorded as gone: no client call at all
    const known = knownNotOwned(downloadHistory);
    if (known && !known.owned) {
      await keepNotOwned(downloadHistory, known, clientType, counts);
      return counts;
    }

    const { getDownloadClientManager } = await import('./download-client-manager.service');
    const manager = getDownloadClientManager(configService);
    const protocol = CLIENT_PROTOCOL_MAP[clientType as DownloadClientType] || 'torrent';
    const client = await manager.getClientServiceForProtocol(protocol as 'torrent' | 'usenet');
    if (!client) return counts;

    if (client.clientType !== clientType) {
      // Another client is configured now: this id means nothing there (or someone else's download)
      logger.warn(`Download ${clientId} was recorded for ${clientType}, but ${client.clientType} is configured now: left as it is`);
      return counts;
    }

    // Get download info to check seeding status
    let downloadInfo;
    try {
      downloadInfo = await client.getDownload(clientId);
    } catch (error) {
      logger.info(`Download ${clientId} not found in ${clientType}, skipping`);
    }
    if (!downloadInfo) return counts;

    // Same rule as the scheduled seeding cleanup: time AND ratio; no config or both 0 = unlimited
    const seeding = evaluateSeeding(seedingConfig, downloadInfo);
    // History can lag the client: the monitor stops polling a cancelled request,
    // so a torrent that finished after the cancel still reads 'downloading' there.
    // The live client state can only mark it complete (keep more), never less.
    const finishedInClient = downloadInfo.status === 'completed'
      || downloadInfo.status === 'seeding'
      || downloadInfo.progress >= 1;
    const isCompleted = downloadHistory.downloadStatus === 'completed' || finishedInClient;

    if (client.protocol === 'usenet') {
      // Usenet: no seeding, so delete now. A job RMAB took over (a duplicate NZB, recorded
      // addedByRmab false) was left alone above; RMAB's own job stays while another active
      // request tracks it (it took it over as a duplicate, #329)
      const others = await otherActiveRequestsUsingNzb(requestId, clientType, clientId);
      if (others.length > 0) {
        logger.info(
          `Keeping download ${clientId} in ${client.clientType}: ${others.length} other active request(s) still use it (IDs: ${others.map((r) => r.id).join(', ')})`
        );
        counts.torrentsKeptShared++;
        return counts;
      }
      try {
        await client.deleteDownload(clientId, true);
        logger.info(`Deleted download ${clientId} from ${client.clientType}`);
        counts.torrentsRemoved++;
      } catch (error) {
        logger.info(`Download ${clientId} not found in ${client.clientType}, skipping`);
      }
      return counts;
    }

    // Only a torrent RMAB added is ever removed or written back for the cleanup job
    const ownership = resolveOwnership(downloadHistory, downloadInfo.addedAt);
    if (!ownership.owned) {
      await keepNotOwned(downloadHistory, ownership, client.clientType, counts);
    } else if (seeding.unlimited) {
      // Unlimited seeding - keep in client, stop monitoring
      logger.info(
        `Keeping download ${downloadInfo.name} for unlimited seeding (indexer: ${downloadHistory.indexerName})`
      );
      counts.torrentsKeptUnlimited++;
    } else if (!isCompleted || seeding.met) {
      // Incomplete, or done seeding: remove it, unless another active request still uses it
      const others = await otherActiveRequestsUsingTorrent(requestId, downloadHistory.torrentHash);
      if (others.length > 0) {
        logger.info(
          `Keeping download ${downloadInfo.name}: ${others.length} other active request(s) still use it (IDs: ${others.map((r) => r.id).join(', ')})`
        );
        counts.torrentsKeptShared++;
      } else {
        logger.info(
          isCompleted
            ? `Deleting download ${downloadInfo.name} (seeding complete: ${seeding.progress})`
            : `Deleting incomplete download: ${downloadInfo.name}`
        );
        await client.deleteDownload(clientId, true);
        counts.torrentsRemoved++;
        // Gone now: the seeding cleanup never checks (or removes by) this row again
        await prisma.downloadHistory.update({ where: { id: downloadHistory.id }, data: { downloadStatus: 'removed' } });
      }
    } else {
      // The scheduled seeding cleanup removes it once the requirement is met.
      // It only looks at 'completed' history, so record a finish the monitor never saw.
      if (downloadHistory.downloadStatus !== 'completed') {
        await prisma.downloadHistory.update({
          where: { id: downloadHistory.id },
          data: { downloadStatus: 'completed', completedAt: downloadHistory.completedAt ?? new Date() },
        });
      }
      logger.info(`Keeping download ${downloadInfo.name} to finish seeding: ${seeding.progress}`);
      counts.torrentsKeptSeeding++;
    }
  } catch (error) {
    logger.error(
      `Error handling download for request ${requestId}`,
      { error: error instanceof Error ? error.message : String(error) }
    );
    // Continue with deletion even if download handling fails
  }
  return counts;
}
