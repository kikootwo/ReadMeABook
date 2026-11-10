/**
 * Component: Cancelled Request - Usenet Download Handling
 * Documentation: documentation/admin-features/request-cancel.md
 *
 * Cancel time only (no strict lookup for usenet, and NZBGet reuses ids): a job RMAB added that is
 * still queued, downloading or paused is deleted from the queue with its files. A finished job
 * stays in the client's history. Nothing retries a usenet job later.
 */

import type { DownloadHistory } from '@/generated/prisma';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import { getClientDisplayName, type DownloadInfo } from '../interfaces/download-client.interface';
import { otherActiveRequestsUsingNzb } from '../utils/shared-torrent';
import { ownsCategory } from '../utils/download-category';
import { CancelDeadline, withinDeadline } from './cancel-deadline';
import type { CancelStepResult } from './cancelled-download';

const logger = RMABLogger.create('CancelledDownload');

const QUEUED_STATES = new Set(['queued', 'downloading', 'paused']);

export async function cancelUsenetDownload(
  requestId: string,
  row: DownloadHistory,
  clientId: string,
  deadline: CancelDeadline
): Promise<CancelStepResult> {
  const clientType = row.downloadClient || 'sabnzbd';
  const clientName = getClientDisplayName(clientType);
  const done = (outcome: CancelStepResult['outcome'], detail: string): CancelStepResult => ({ outcome, detail, clientName });

  // Only a job RMAB itself added (recorded before this was tracked = keep)
  if (row.addedByRmab !== true) return done('kept_not_owned', 'not recorded as added by RMAB');

  const { getConfigService } = await import('./config.service');
  const { getDownloadClientManager } = await import('./download-client-manager.service');
  const manager = getDownloadClientManager(getConfigService());
  const client = await manager.getClientServiceForProtocol('usenet');
  if (!client || client.clientType !== clientType) return done('not_removed', `${clientName} is not the configured usenet client`);

  let info: DownloadInfo | null;
  try {
    info = await withinDeadline(client.getDownload(clientId), deadline);
  } catch (error) {
    return done('not_removed', error instanceof Error ? error.message : String(error));
  }
  if (!info) return done('none', `no longer in ${clientName}`);
  if (!QUEUED_STATES.has(info.status)) return done('kept_finished', `job is ${info.status}`);

  const others = await otherActiveRequestsUsingNzb(requestId, clientType, clientId);
  if (others.length > 0) return done('kept_shared', `other request(s) use it: ${others.map((r) => r.id).join(', ')}`);

  if (deadline.passed()) return done('not_removed', 'cancel deadline passed before the delete');
  const stillCancelled = await prisma.downloadHistory.findFirst({
    where: { id: row.id, selected: true, request: { status: 'cancelled', deletedAt: null } },
    select: { id: true },
  });
  if (!stillCancelled) return done('none', 'request no longer cancelled');
  if (deadline.passed()) return done('not_removed', 'cancel deadline passed before the delete');

  try {
    // Queue only (a finished job in history is never touched); 'deleted' only when the client confirms it
    if (!client.deleteQueuedDownload) return done('not_removed', 'no queue-only delete');
    // A category that already existed in the client (another app's) proves nothing: match by name only
    const config = await manager.getClientForProtocol('usenet');
    const category = config?.category || 'readmeabook';
    const owned = ownsCategory(category, config?.ownedCategory);
    const deleted = await client.deleteQueuedDownload(clientId, { name: row.torrentName, ...(owned && { category }) });
    if (deleted === 'not_queued') return done('kept_finished', 'job left the queue');
    if (deleted === 'mismatch') return done('kept_not_owned', 'queued job does not match');
    if (deleted === 'unconfirmed') return done('not_removed', `${clientName} did not confirm the delete`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Could not remove job ${clientId} from ${clientName} for cancelled request ${requestId}: ${message}`);
    return done('not_removed', message);
  }

  logger.info(`Removed job ${clientId} and its files from ${clientName} (cancelled request ${requestId})`);
  if (!deadline.passed()) {
    await prisma.downloadHistory.update({ where: { id: row.id }, data: { downloadStatus: 'removed' } });
  }
  return done('removed', 'queued job deleted');
}
