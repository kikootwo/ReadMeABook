/**
 * Component: Shared Torrent Guard
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Several requests can share one torrent (e.g. re-requesting the same book, a series pack). Before a
 * torrent is removed from the client, request delete, the seeding cleanup and the cancel step all ask
 * `torrentHolds()`, which applies one rule (`holdOf()`, table in request-deletion.md#shared-torrent-holds):
 * an active request keeps it until it is finished and done seeding (#283); a deleted or cancelled one keeps
 * a finished torrent it owns only until its own indexer's rule is met (#545).
 */

import { prisma } from '../db';
import { torrentHashForms } from '../integrations/torrent-ids';
import type { SeedingEvaluation } from './seeding-policy';
import { resolveOwnership } from './torrent-ownership';

export interface ActiveRequestRef {
  id: string;
  status: string;
}

/** Finished requests (the seeding cleanup's active candidates): nothing more will read the torrent */
export const FINISHED_REQUESTS = [
  { type: 'audiobook', status: 'available' },
  { type: 'ebook', status: 'downloaded' },
] as const;

/** Another request using the torrent, with its selected row(s) for that torrent */
export interface TorrentSibling extends ActiveRequestRef {
  type: string;
  /** Its book record (shared by every request for the book); the organizer completes it after a successful copy */
  audiobook: SiblingBookRecord | null;
  downloadHistory: TorrentSiblingDownload[];
}

export interface SiblingBookRecord {
  status: string;
  filePath: string | null;
  completedAt: Date | null;
}

export interface TorrentSiblingDownload {
  id: string;
  indexerId: number | null;
  indexerName: string | null;
  downloadClient: string | null;
  createdAt: Date;
  /** 'removed': the request no longer uses the torrent through this row */
  downloadStatus?: string | null;
  /** Ownership (#423): deleted and cancelled requests hold only through a row that owns the torrent */
  addedByRmab?: boolean | null;
}

/** A request whose selected row is this torrent: active (not deleted) or soft-deleted */
export interface TorrentUser extends TorrentSibling {
  deleted: boolean;
}

/**
 * - `active`: an active request that owns the torrent; it removes the torrent itself once it lets go
 * - `until_met`: the hold ends, but the holder may never remove the torrent itself (a deleted or
 *   cancelled request, or an active one that only took the torrent over): a soft-deleted candidate stays
 * - `forever`: nothing releases it (a cancelled request with unlimited seeding)
 */
export type HoldKind = 'active' | 'until_met' | 'forever';

export interface TorrentHold {
  requestId: string;
  kind: HoldKind;
  reason: string;
}

export interface HoldCheck {
  /** The configured client type the torrent is in */
  clientType: string;
  /** The client's added time for the torrent (`resolveOwnership` of the other requests' rows) */
  addedAt: Date | undefined;
  /** A row's own indexer rule by the client's answer for a finished torrent; null = the torrent is partial */
  seeding: ((row: TorrentSiblingDownload) => SeedingEvaluation) | null;
}

const NOT_REMOVED = { OR: [{ downloadStatus: null }, { downloadStatus: { not: 'removed' } }] };
const recordedFor = (row: { downloadClient: string | null }) => row.downloadClient || 'qbittorrent';

/** Rows recorded for `clientType` (a row without a client is qBittorrent's) */
function recordedForClient(clientType: string) {
  return clientType === 'qbittorrent'
    ? { OR: [{ downloadClient: null }, { downloadClient: '' }, { downloadClient: 'qbittorrent' }] }
    : { downloadClient: clientType };
}

/**
 * Usenet (#329): active requests other than `requestId` whose selected download is the same
 * client job (a duplicate NZB another request took over). Empty when there is no id.
 */
export async function otherActiveRequestsUsingNzb(
  requestId: string,
  downloadClient: string,
  nzbId: string | null | undefined
): Promise<ActiveRequestRef[]> {
  if (!nzbId) return [];
  return prisma.request.findMany({
    where: {
      id: { not: requestId },
      deletedAt: null,
      downloadHistory: {
        some: { downloadClient, selected: true, OR: [{ downloadClientId: nzbId }, { nzbId }] },
      },
    },
    select: { id: true, status: true },
  });
}

const SIBLING_ROW_SELECT = {
  id: true, indexerId: true, indexerName: true, downloadClient: true, createdAt: true, downloadStatus: true, addedByRmab: true,
} as const;

/**
 * Active (not deleted) requests other than `requestId` whose selected download is the torrent `torrentHash`
 * (hex and base32 forms, in either letter case, match each other), with their selected rows for it
 */
export async function otherActiveRequestsSharingTorrent(
  requestId: string,
  torrentHash: string | null | undefined
): Promise<TorrentSibling[]> {
  if (!torrentHash) return [];
  const forms = torrentHashForms(torrentHash);
  return prisma.request.findMany({
    where: { id: { not: requestId }, deletedAt: null, downloadHistory: { some: { torrentHash: { in: forms }, selected: true } } },
    select: {
      id: true,
      status: true,
      type: true,
      audiobook: { select: { status: true, filePath: true, completedAt: true } },
      downloadHistory: { where: { torrentHash: { in: forms }, selected: true }, select: SIBLING_ROW_SELECT },
    },
  });
}

/** A soft-deleted request whose selected row for the torrent is not recorded as gone */
export interface SoftDeletedHolder {
  id: string;
  downloadHistory: TorrentSiblingDownload[];
}

/** Soft-deleted requests other than `requestId` whose selected row for `torrentHash` is not 'removed' */
export async function softDeletedHoldersOfTorrent(
  requestId: string,
  torrentHash: string | null | undefined
): Promise<SoftDeletedHolder[]> {
  if (!torrentHash) return [];
  const row = { torrentHash: { in: torrentHashForms(torrentHash) }, selected: true, ...NOT_REMOVED };
  return prisma.request.findMany({
    where: { id: { not: requestId }, deletedAt: { not: null }, downloadHistory: { some: row } },
    select: { id: true, downloadHistory: { where: row, select: SIBLING_ROW_SELECT } },
  });
}

/**
 * Cancelled-download cleanup only: another active request for the same book that is searching or
 * downloading and has no selected download yet (it may be about to grab this torrent), or null.
 */
export async function sameBookGrabInProgress(
  requestId: string,
  audiobookId: string,
  type: string
): Promise<ActiveRequestRef | null> {
  return prisma.request.findFirst({
    where: {
      id: { not: requestId },
      audiobookId,
      type,
      deletedAt: null,
      status: { in: ['searching', 'downloading'] },
      downloadHistory: { none: { selected: true } },
    },
    select: { id: true, status: true },
  });
}

/** Client states that are clearly a partial download (a state in neither this set nor completed/seeding is unclear) */
export const PARTIAL_TORRENT_STATES = new Set(['downloading', 'queued', 'paused']);

/**
 * The torrent is partial only when nothing says it finished: a partial state, progress < 1, no completed
 * time, and its row not recorded completed. A recheck reports progress < 1 on a finished torrent.
 */
export function clearlyPartial(
  info: { status: string; progress: number; completedAt?: Date },
  rowStatus: string | null | undefined
): boolean {
  return PARTIAL_TORRENT_STATES.has(info.status) && info.progress < 1 && !info.completedAt && rowStatus !== 'completed';
}

/**
 * A library scan can mark an audiobook `available` while its organize is still copying (#283).
 * Only the organizer completes the book record with a `filePath`, after the copy; it must have done
 * so after this row took the torrent, since the record is shared by every request for the book.
 * A book only matched in the library (no RMAB import) never passes.
 */
function importedSince(book: SiblingBookRecord | null, row: TorrentSiblingDownload): boolean {
  if (book?.status !== 'completed' || !book.filePath || !book.completedAt) return false;
  return new Date(book.completedAt).getTime() > new Date(row.createdAt).getTime();
}

/**
 * Why an active `sibling` still needs a finished torrent, or null when it lets it go (#283). It lets
 * it go only when it is finished (an audiobook also imported by RMAB since it took the torrent), every
 * row it has for the torrent was recorded for `clientType`, and its own indexer's requirement is met
 * (`seeding(row)`, by the same client answer).
 */
export function siblingKeepsTorrent(
  sibling: TorrentSibling,
  clientType: string,
  seeding: (row: TorrentSiblingDownload) => SeedingEvaluation
): string | null {
  if (!FINISHED_REQUESTS.some((f) => f.type === sibling.type && f.status === sibling.status)) {
    return `${sibling.type ?? 'request'} ${sibling.status}`;
  }
  const rows = sibling.downloadHistory ?? [];
  if (rows.length === 0) return 'no download row for this torrent';
  for (const row of rows) {
    if (recordedFor(row) !== clientType) return `recorded for ${recordedFor(row)}`;
    if (sibling.type === 'audiobook' && !importedSince(sibling.audiobook, row)) {
      return 'no RMAB import since it took this torrent';
    }
    const { unlimited, met, progress } = seeding(row);
    if (unlimited) return `unlimited seeding (${row.indexerName ?? 'no indexer'})`;
    if (!met) return `still seeding for ${row.indexerName ?? 'its indexer'}: ${progress}`;
  }
  return null;
}

/**
 * The rule (#545): whether `user` keeps the torrent, and of which kind, or null.
 * - Only its live rows count (not 'removed'); none: it never keeps it.
 * - Deleted or cancelled: keeps a finished torrent only through a live row that owns it
 *   (`resolveOwnership` on the client's added time, recorded for the configured client) until that
 *   row's own rule is met; a cancelled one with unlimited seeding keeps it forever. Never a partial one.
 * - Active: keeps a partial torrent; a finished one per `siblingKeepsTorrent`. With no live row that
 *   owns the torrent it can never remove it itself, so the hold is `until_met`.
 */
export function holdOf(user: TorrentUser, check: HoldCheck): TorrentHold | null {
  const live = (user.downloadHistory ?? []).filter((row) => row.downloadStatus !== 'removed');
  if (live.length === 0) return null;
  const owned = live.filter((row) => recordedFor(row) === check.clientType
    && resolveOwnership({ addedByRmab: row.addedByRmab ?? null, createdAt: row.createdAt, downloadStatus: row.downloadStatus }, check.addedAt).owned);
  const hold = (kind: HoldKind, reason: string): TorrentHold => ({ requestId: user.id, kind, reason });

  if (user.deleted || user.status === 'cancelled') {
    if (!check.seeding) return null;
    const state = user.deleted ? 'deleted' : 'cancelled';
    for (const row of owned) {
      const { unlimited, met, progress } = check.seeding(row);
      if (unlimited) {
        // A deleted request with unlimited seeding is forgotten by the seeding cleanup without a removal
        if (user.deleted) continue;
        return hold('forever', `${state}, unlimited seeding (${row.indexerName ?? 'no indexer'})`);
      }
      if (!met) return hold('until_met', `${state}, still seeding for ${row.indexerName ?? 'its indexer'}: ${progress}`);
    }
    return null;
  }

  const kind: HoldKind = owned.length > 0 ? 'active' : 'until_met';
  if (!check.seeding) return hold(kind, `${user.type ?? 'request'} ${user.status}`);
  const reason = siblingKeepsTorrent({ ...user, downloadHistory: live }, check.clientType, check.seeding);
  return reason ? hold(kind, reason) : null;
}

/**
 * Every request other than `requestId` that keeps the torrent `torrentHash`, by `holdOf()`. Soft-deleted
 * requests are read only for a finished torrent (they never keep a partial one).
 */
export async function torrentHolds(requestId: string, torrentHash: string | null | undefined, check: HoldCheck): Promise<TorrentHold[]> {
  if (!torrentHash) return [];
  const active = (await otherActiveRequestsSharingTorrent(requestId, torrentHash))
    .map((sibling): TorrentUser => ({ ...sibling, deleted: false }));
  const deleted = check.seeding
    ? (await softDeletedHoldersOfTorrent(requestId, torrentHash))
      .map((holder): TorrentUser => ({ ...holder, status: 'deleted', type: 'request', audiobook: null, deleted: true }))
    : [];
  return [...active, ...deleted].flatMap((user) => holdOf(user, check) ?? []);
}

/** For a log line: `id (reason), id (reason)` */
export function describeHolds(holds: TorrentHold[]): string {
  return holds.map((h) => `${h.requestId} (${h.reason})`).join(', ');
}

/**
 * The torrent is gone from `clientType`: every other request's selected row for it recorded for that
 * client, created by `holdsReadAt` (when the holds were read, before the client delete), says so too
 * (deleted ones included). A grab that lands after the delete keeps its row. Returns the number marked.
 */
export async function markOtherRowsRemoved(
  requestId: string,
  torrentHash: string | null | undefined,
  clientType: string,
  holdsReadAt: Date
): Promise<number> {
  if (!torrentHash) return 0;
  const { count } = await prisma.downloadHistory.updateMany({
    where: {
      requestId: { not: requestId },
      selected: true,
      torrentHash: { in: torrentHashForms(torrentHash) },
      createdAt: { lte: holdsReadAt },
      AND: [NOT_REMOVED, recordedForClient(clientType)],
    },
    data: { downloadStatus: 'removed' },
  });
  return count;
}
