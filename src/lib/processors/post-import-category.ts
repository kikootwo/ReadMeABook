/**
 * Component: Post-Import Category
 * Documentation: documentation/phase3/download-clients.md
 *
 * After a successful import, moves the torrent to the client's post-import category,
 * only for a torrent RMAB added itself.
 */

import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getConfigService } from '../services/config.service';
import { getDownloadClientManager } from '../services/download-client-manager.service';
import { CLIENT_PROTOCOL_MAP, DownloadClientType } from '../interfaces/download-client.interface';
import { resolveOwnership } from '../utils/torrent-ownership';

/**
 * Apply post-import category to the download client after successful import.
 * Only applies to torrent clients (qBittorrent/Transmission) when configured.
 * Non-fatal: logs a warning on failure but does not fail the job.
 */
export async function applyPostImportCategory(
  requestId: string,
  logger: RMABLogger
): Promise<void> {
  try {
    // Get download history to find client type and download ID
    const downloadHistory = await prisma.downloadHistory.findFirst({
      where: { requestId },
      orderBy: { createdAt: 'desc' },
    });

    if (!downloadHistory?.downloadClientId || !downloadHistory?.downloadClient) {
      return;
    }

    const clientType = downloadHistory.downloadClient as DownloadClientType;

    // Only applies to torrent clients
    const protocol = CLIENT_PROTOCOL_MAP[clientType];
    if (protocol !== 'torrent') {
      return;
    }

    // Get client config and check if postImportCategory is set
    const configService = getConfigService();
    const manager = getDownloadClientManager(configService);
    const clients = await manager.getAllClients();
    const clientConfig = clients.find(c => c.enabled && c.type === clientType);

    if (!clientConfig?.postImportCategory) {
      return;
    }

    // Only a torrent RMAB added: a category change can move files (qBittorrent automatic
    // management) or replace labels (Transmission, Deluge). Unknown (null: grabbed before RMAB
    // recorded ownership) counts as not RMAB's here.
    const id = downloadHistory.downloadClientId;
    const skip = (why: string) => logger.info(`Post-import category not applied to ${id}: ${why}`);
    if (downloadHistory.addedByRmab !== true) {
      return skip(downloadHistory.addedByRmab === false ? 'it was already there when RMAB grabbed it' : 'RMAB can\'t tell whether it added this torrent');
    }
    const service = await manager.createClientFromConfig(clientConfig);
    // Same rule as the seeding cleanup and request delete (removed rows, re-added or older copies)
    let addedAt: Date | undefined;
    if (downloadHistory.downloadStatus !== 'removed') {
      const probe = service.probeDownload ? await service.probeDownload(id).catch(() => null) : null;
      if (!probe?.found) return skip('the client did not confirm the torrent');
      addedAt = probe.info.addedAt;
    }
    const ownership = resolveOwnership(downloadHistory, addedAt);
    if (!ownership.owned) return skip(ownership.detail);

    logger.info(`Applying post-import category "${clientConfig.postImportCategory}" to download ${id}`);
    await service.setCategory(id, clientConfig.postImportCategory);

    logger.info(`Post-import category applied successfully`);
  } catch (error) {
    logger.warn(`Failed to apply post-import category: ${error instanceof Error ? error.message : String(error)}`);
  }
}
