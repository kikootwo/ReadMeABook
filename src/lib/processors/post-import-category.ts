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
    // management) or replace labels (Transmission, Deluge). Unknown (null) counts as not RMAB's.
    if (downloadHistory.addedByRmab !== true) {
      logger.info(`Post-import category not applied to ${downloadHistory.downloadClientId}: RMAB did not add this torrent (or can't tell)`);
      return;
    }

    logger.info(`Applying post-import category "${clientConfig.postImportCategory}" to download ${downloadHistory.downloadClientId}`);

    const service = await manager.createClientFromConfig(clientConfig);
    await service.setCategory(downloadHistory.downloadClientId, clientConfig.postImportCategory);

    logger.info(`Post-import category applied successfully`);
  } catch (error) {
    logger.warn(`Failed to apply post-import category: ${error instanceof Error ? error.message : String(error)}`);
  }
}
