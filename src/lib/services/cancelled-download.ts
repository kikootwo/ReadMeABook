/**
 * Component: Cancelled Request - Download Handling
 * Documentation: documentation/admin-features/request-cancel.md
 *
 * What a cancel does with the request's newest selected download: remove a partial torrent RMAB
 * added, keep a finished one until its indexer's seeding rule is met, leave anything unclear alone.
 * Shared by the cancel itself (with a deadline) and the cancelled-download pass of the seeding
 * cleanup (no deadline). Never throws; fails toward keeping.
 */

import type { DownloadHistory } from '@/generated/prisma';
import { prisma } from '../db';
import { RMABLogger } from '../utils/logger';
import {
  CLIENT_PROTOCOL_MAP,
  getClientDisplayName,
  type DownloadClientType,
  type DownloadInfo,
} from '../interfaces/download-client.interface';
import { evaluateSeeding, type SeedingRequirement } from '../utils/seeding-policy';
import { createIndexerConfigLookup, parseSavedIndexers, type IndexerConfigMatch, type IndexerRef } from '../utils/indexer-config';
import { knownNotOwned, resolveOwnership } from '../utils/torrent-ownership';
import { torrentHashForms } from '../integrations/torrent-ids';
import {
  otherActiveRequestsSharingTorrent,
  sameBookGrabInProgress,
  siblingKeepsTorrent,
  softDeletedHoldersOfTorrent,
} from '../utils/shared-torrent';
import { CANCEL_STEP_BUDGET_MS, CancelDeadline, withinDeadline } from './cancel-deadline';
import { cancelUsenetDownload } from './cancelled-download-usenet';

const logger = RMABLogger.create('CancelledDownload');

export type CancelDownloadOutcome =
  | 'removed'
  | 'kept_seeding'
  | 'kept_unlimited'
  | 'kept_shared'
  | 'kept_not_owned'
  /** Usenet: the job had already finished (or stopped) in the client */
  | 'kept_finished'
  /** Torrent: nothing changed now; the cancelled-download pass of the seeding cleanup tries again */
  | 'retry_later'
  /** Usenet: removing the job failed; nothing retries it */
  | 'not_removed'
  | 'none';

export interface CancelStepResult {
  outcome: CancelDownloadOutcome;
  /** Display name of the download client, for admin messages */
  clientName?: string;
  /** The strict lookup failed or timed out (the pass stops after a few in a row) */
  probeError?: boolean;
  /** The strict lookup answered that the torrent is gone */
  missing?: boolean;
  detail: string;
}

/** A saved `prowlarr_indexers` entry (the seeding fields this step reads) */
export interface SavedIndexerEntry extends SeedingRequirement {
  id?: unknown;
  name?: unknown;
  protocol?: unknown;
}

export type IndexerLookup = (ref: IndexerRef) => IndexerConfigMatch<SavedIndexerEntry>;
type ConfigFor = (ref: { indexerId: number | null; indexerName: string | null }) => SeedingRequirement | undefined;

export interface CancelStepContext {
  mode: 'cancel' | 'sweep';
  /** Cancel time: no client delete and no row write once it has passed */
  deadline?: CancelDeadline;
  /** Sweep: torrents removed earlier in this run (lower-case ids) */
  deletedHashes?: Set<string>;
  /** Sweep: built once per run. Omitted: loaded here; null: the saved indexer list is missing or unreadable */
  lookupIndexer?: IndexerLookup | null;
}

export interface CancelledRequestRef {
  id: string;
  audiobookId: string;
  type: string;
}

const FINISHED_STATES = new Set(['completed', 'seeding']);
const PARTIAL_STATES = new Set(['downloading', 'queued', 'paused']);

const result = (outcome: CancelDownloadOutcome, detail: string, extra: Partial<CancelStepResult> = {}): CancelStepResult =>
  ({ outcome, detail, ...extra });

async function loadIndexerLookup(): Promise<IndexerLookup | null> {
  const { getConfigService } = await import('./config.service');
  const saved = parseSavedIndexers(await getConfigService().get('prowlarr_indexers'));
  return saved ? createIndexerConfigLookup(saved as SavedIndexerEntry[]) : null;
}

/** The request's newest selected download row, or null */
export function newestSelectedRow(requestId: string): Promise<DownloadHistory | null> {
  return prisma.downloadHistory.findFirst({
    where: { requestId, selected: true },
    orderBy: { createdAt: 'desc' },
  });
}

/** Right before a delete: still cancelled, not deleted or replaced, and the row still selected and not gone */
async function stillCancelled(requestId: string, rowId: string): Promise<boolean> {
  const row = await prisma.downloadHistory.findFirst({
    where: {
      id: rowId,
      requestId,
      selected: true,
      OR: [{ downloadStatus: null }, { downloadStatus: { not: 'removed' } }],
      request: { status: 'cancelled', deletedAt: null },
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Handle the newest selected download of a cancelled request (`row`, or null when it has none).
 * Every client call and write happens here; the caller only reports the result.
 */
export async function handleCancelledDownload(
  request: CancelledRequestRef,
  row: DownloadHistory | null,
  ctx: CancelStepContext
): Promise<CancelStepResult> {
  try {
    return await decide(request, row, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Cancelled request ${request.id}: download left as it is: ${message}`);
    const usenet = row?.downloadClient ? CLIENT_PROTOCOL_MAP[row.downloadClient as DownloadClientType] === 'usenet' : false;
    return result(usenet ? 'not_removed' : 'retry_later', message);
  }
}

/** The grab job: a cancel landed while the download was being added (same step and deadline as a cancel) */
export async function stopCancelledDownload(requestId: string): Promise<CancelStepResult> {
  const request = await prisma.request.findUnique({ where: { id: requestId }, select: { id: true, audiobookId: true, type: true } });
  if (!request) return result('none', 'request gone');
  return handleCancelledDownload(request, await newestSelectedRow(requestId), {
    mode: 'cancel',
    deadline: CancelDeadline.in(CANCEL_STEP_BUDGET_MS),
  });
}

async function decide(request: CancelledRequestRef, row: DownloadHistory | null, ctx: CancelStepContext): Promise<CancelStepResult> {
  const deadline = ctx.deadline ?? CancelDeadline.none();
  if (!row) return result('none', 'no download');
  if (row.downloadStatus === 'removed' || row.downloadStatus === 'failed') {
    return result('none', `download already ${row.downloadStatus}`);
  }
  const clientType = row.downloadClient || 'qbittorrent';
  const clientId = row.downloadClientId || row.torrentHash || row.nzbId;
  const protocol = CLIENT_PROTOCOL_MAP[clientType as DownloadClientType];
  if (!clientId || !protocol) return result('none', `no client download (${clientType})`);
  const clientName = getClientDisplayName(clientType);

  const known = knownNotOwned(row);
  if (known && !known.owned) return result('kept_not_owned', known.detail, { clientName });

  // An NZB id without a torrent hash is usenet whatever the recorded client (as in the seeding pass)
  if (protocol === 'usenet' || (row.nzbId && !row.torrentHash)) {
    if (ctx.mode === 'sweep') return result('none', 'usenet: handled at cancel time only');
    return cancelUsenetDownload(request.id, row, clientId, deadline);
  }

  const lookupIndexer = ctx.lookupIndexer === undefined ? await loadIndexerLookup() : ctx.lookupIndexer;
  const configFor: ConfigFor = (ref) =>
    lookupIndexer?.({ indexerId: ref.indexerId, indexerName: ref.indexerName ?? '', protocol })?.config;

  // Finished under an unlimited rule, already recorded: no client call (a later config change is picked up)
  if (row.downloadStatus === 'completed' && lookupIndexer && evaluateSeeding(configFor(row), {}).unlimited) {
    return result('kept_unlimited', 'finished, unlimited seeding', { clientName });
  }

  const { getConfigService } = await import('./config.service');
  const { getDownloadClientManager } = await import('./download-client-manager.service');
  const client = await getDownloadClientManager(getConfigService()).getClientServiceForProtocol('torrent');
  if (!client) return result('retry_later', 'no torrent client configured', { clientName });
  if (client.clientType !== clientType) {
    logger.warn(`Download ${clientId} was recorded for ${clientType}, but ${client.clientType} is configured now: left as it is`);
    return result('none', 'recorded for another client type', { clientName });
  }

  const markRemoved = async (why: string) => {
    if (deadline.passed()) return logger.info(`${why}: past the cancel deadline, the seeding cleanup records it`);
    await prisma.downloadHistory.update({ where: { id: row.id }, data: { downloadStatus: 'removed' } });
  };

  if (ctx.deletedHashes?.has(clientId.toLowerCase())) {
    await markRemoved(`Download ${clientId} removed earlier this run`);
    return result('removed', 'removed earlier in this run', { clientName });
  }

  // Strict lookup only: an error or timeout changes nothing
  let info: DownloadInfo;
  try {
    if (!client.probeDownload) throw new Error(`${client.clientType} has no strict lookup`);
    const probe = await withinDeadline(client.probeDownload(clientId), deadline);
    if (!probe.found) {
      await markRemoved(`Download ${clientId} is gone from ${clientName}`);
      return result('none', `no longer in ${clientName}`, { clientName, missing: true });
    }
    info = probe.info;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Could not check ${clientId} in ${clientName} for cancelled request ${request.id}, nothing changed: ${message}`);
    return result('retry_later', message, { clientName, probeError: true });
  }

  const ownership = resolveOwnership(row, info.addedAt);
  if (!ownership.owned) {
    logger.info(`Leaving ${info.name} in ${clientName}: ${ownership.detail}`);
    if (ownership.recordNotOwned && !deadline.passed()) {
      await prisma.downloadHistory.update({ where: { id: row.id }, data: { addedByRmab: false } });
    }
    return result('kept_not_owned', ownership.detail, { clientName });
  }

  // A recheck reports progress < 1 on a finished torrent: anything not clearly partial or finished is kept
  const finished = FINISHED_STATES.has(info.status) || info.progress >= 1 || !!info.completedAt
    || row.downloadStatus === 'completed';
  const unclear = !FINISHED_STATES.has(info.status) && !PARTIAL_STATES.has(info.status);
  if (unclear) return result('retry_later', `state ${info.status}`, { clientName });

  const torrentHash = row.torrentHash || clientId;
  const remove = async (why: string): Promise<CancelStepResult> => {
    const hold = await holdReason(request, torrentHash, clientType, finished ? info : null, configFor);
    if (hold) {
      logger.info(`Keeping ${info.name} in ${clientName} for cancelled request ${request.id}: ${hold}`);
      return result('kept_shared', hold, { clientName });
    }
    if (deadline.passed()) return result('retry_later', 'cancel deadline passed before the delete', { clientName });
    if (!(await stillCancelled(request.id, row.id))) {
      return result('none', 'request no longer cancelled, or its download changed', { clientName });
    }
    if (deadline.passed()) return result('retry_later', 'cancel deadline passed before the delete', { clientName });
    try {
      await client.deleteDownload(clientId, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Could not remove ${info.name} from ${clientName} for cancelled request ${request.id}: ${message}`);
      return result('retry_later', message, { clientName });
    }
    ctx.deletedHashes?.add(clientId.toLowerCase());
    logger.info(`Removed ${info.name} and its files from ${clientName} (cancelled request ${request.id}, ${why})`);
    await markRemoved(`Removed ${info.name}`);
    await markSiblingRowsRemoved(request.id, torrentHash, deadline);
    return result('removed', why, { clientName });
  };

  if (!finished) return remove('partial download');

  if (!lookupIndexer) {
    // Same as the seeding cleanup: no readable indexer settings, change nothing
    return result('retry_later', 'indexer settings missing or unreadable', { clientName });
  }
  const seeding = evaluateSeeding(configFor(row), info);
  if (seeding.unlimited || !seeding.met) {
    if (row.downloadStatus !== 'completed' && !deadline.passed()) {
      // The pass skips a recorded unlimited finish without a client call
      await prisma.downloadHistory.update({
        where: { id: row.id },
        data: { downloadStatus: 'completed', completedAt: row.completedAt ?? new Date() },
      });
    }
    logger.info(`Keeping finished ${info.name} in ${clientName}: ${seeding.unlimited ? 'unlimited seeding' : seeding.progress}`);
    return result(seeding.unlimited ? 'kept_unlimited' : 'kept_seeding', seeding.progress, { clientName });
  }
  return remove(`seeding done: ${seeding.progress}`);
}

/**
 * Why the torrent must stay for someone else, or null. `finishedInfo` is the client's answer for a
 * finished torrent (null for a partial one).
 */
async function holdReason(
  request: CancelledRequestRef,
  torrentHash: string,
  clientType: string,
  finishedInfo: DownloadInfo | null,
  configFor: ConfigFor
): Promise<string | null> {
  // Cancelled siblings never hold it
  const siblings = (await otherActiveRequestsSharingTorrent(request.id, torrentHash)).filter((s) => s.status !== 'cancelled');
  if (finishedInfo === null) {
    if (siblings.length > 0) return `other request(s) use it: ${siblings.map((s) => s.id).join(', ')}`;
  } else {
    for (const sibling of siblings) {
      const reason = siblingKeepsTorrent(sibling, clientType, (r) => evaluateSeeding(configFor(r), finishedInfo));
      if (reason) return `request ${sibling.id} still uses it (${reason})`;
    }
    // A deleted request keeping the finished torrent to seed holds it until its own rule is met
    for (const holder of await softDeletedHoldersOfTorrent(request.id, torrentHash)) {
      for (const r of holder.downloadHistory) {
        if ((r.downloadClient || 'qbittorrent') !== clientType) return `deleted request ${holder.id} recorded it for another client`;
        const seeding = evaluateSeeding(configFor(r), finishedInfo);
        if (seeding.unlimited || !seeding.met) return `deleted request ${holder.id} still seeds it (${seeding.progress})`;
      }
    }
  }
  const grab = await sameBookGrabInProgress(request.id, request.audiobookId, request.type);
  if (grab) return `request ${grab.id} for the same book is ${grab.status} without a download yet`;
  return null;
}

/** The torrent is gone: every other request's selected row for it says so too */
async function markSiblingRowsRemoved(requestId: string, torrentHash: string, deadline: CancelDeadline): Promise<void> {
  if (deadline.passed()) return;
  await prisma.downloadHistory.updateMany({
    where: {
      requestId: { not: requestId },
      selected: true,
      torrentHash: { in: torrentHashForms(torrentHash) },
      OR: [{ downloadStatus: null }, { downloadStatus: { not: 'removed' } }],
    },
    data: { downloadStatus: 'removed' },
  });
}
