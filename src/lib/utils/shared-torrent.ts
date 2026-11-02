/**
 * Component: Shared Torrent Guard
 * Documentation: documentation/admin-features/request-deletion.md
 *
 * Several requests can share one torrent (e.g. re-requesting the same book, a series pack).
 * Before a torrent is removed from the client, every caller checks the other active requests
 * that use it. Request deletion: any of them keeps it. Scheduled seeding cleanup: each of them
 * keeps it unless it is finished and its own indexer's seeding requirement is met (#283).
 */

import { prisma } from '../db';
import { torrentHashForms } from '../integrations/torrent-ids';
import type { SeedingEvaluation } from './seeding-policy';

export interface ActiveRequestRef {
  id: string;
  status: string;
}

/** Finished requests (the seeding cleanup's active candidates): nothing more will read the torrent */
export const FINISHED_REQUESTS = [
  { type: 'audiobook', status: 'available' },
  { type: 'ebook', status: 'downloaded' },
] as const;

/** Another active request using the torrent, with its selected row(s) for that torrent */
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
}

function otherActiveRequestsWhere(requestId: string, torrentHash: string) {
  return {
    id: { not: requestId },
    deletedAt: null,
    downloadHistory: {
      some: {
        torrentHash: { in: torrentHashForms(torrentHash) },
        selected: true,
      },
    },
  };
}

/**
 * Active (not deleted) requests other than `requestId` whose selected
 * download is the torrent `torrentHash` (hex and base32 forms, in either letter case, match each other). Empty when there is no hash.
 * Request deletion keeps the torrent while this is not empty.
 */
export async function otherActiveRequestsUsingTorrent(
  requestId: string,
  torrentHash: string | null | undefined
): Promise<ActiveRequestRef[]> {
  if (!torrentHash) return [];
  return prisma.request.findMany({
    where: otherActiveRequestsWhere(requestId, torrentHash),
    select: { id: true, status: true },
  });
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

/** Same requests as `otherActiveRequestsUsingTorrent`, with type and their selected rows for this torrent (seeding cleanup) */
export async function otherActiveRequestsSharingTorrent(
  requestId: string,
  torrentHash: string | null | undefined
): Promise<TorrentSibling[]> {
  if (!torrentHash) return [];
  return prisma.request.findMany({
    where: otherActiveRequestsWhere(requestId, torrentHash),
    select: {
      id: true,
      status: true,
      type: true,
      audiobook: { select: { status: true, filePath: true, completedAt: true } },
      downloadHistory: {
        where: { torrentHash: { in: torrentHashForms(torrentHash) }, selected: true },
        select: { id: true, indexerId: true, indexerName: true, downloadClient: true, createdAt: true },
      },
    },
  });
}

/** A soft-deleted request whose selected row for the torrent is not recorded as gone */
export interface SoftDeletedHolder {
  id: string;
  downloadHistory: TorrentSiblingDownload[];
}

const NOT_REMOVED = { OR: [{ downloadStatus: null }, { downloadStatus: { not: 'removed' } }] };

/**
 * Cancelled-download cleanup only: soft-deleted requests other than `requestId` whose selected row for
 * `torrentHash` is not 'removed' (a deleted request can keep its finished torrent to seed). The caller
 * lets each go once its own indexer's rule is met; such a holder never keeps a partial torrent.
 */
export async function softDeletedHoldersOfTorrent(
  requestId: string,
  torrentHash: string | null | undefined
): Promise<SoftDeletedHolder[]> {
  if (!torrentHash) return [];
  const row = { torrentHash: { in: torrentHashForms(torrentHash) }, selected: true, ...NOT_REMOVED };
  return prisma.request.findMany({
    where: { id: { not: requestId }, deletedAt: { not: null }, downloadHistory: { some: row } },
    select: {
      id: true,
      downloadHistory: {
        where: row,
        select: { id: true, indexerId: true, indexerName: true, downloadClient: true, createdAt: true },
      },
    },
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
 * Seeding cleanup only (#283): why `sibling` still needs the torrent, or null when it lets it go.
 * It lets it go only when it is finished (an audiobook also imported by RMAB since it took the
 * torrent), every row it has for the torrent was recorded for `clientType`, and its own indexer's
 * requirement is met (`seeding(row)`, by the same client answer).
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
    const recordedFor = row.downloadClient || 'qbittorrent';
    if (recordedFor !== clientType) return `recorded for ${recordedFor}`;
    if (sibling.type === 'audiobook' && !importedSince(sibling.audiobook, row)) {
      return 'no RMAB import since it took this torrent';
    }
    const { unlimited, met, progress } = seeding(row);
    if (unlimited) return `unlimited seeding (${row.indexerName ?? 'no indexer'})`;
    if (!met) return `still seeding for ${row.indexerName ?? 'its indexer'}: ${progress}`;
  }
  return null;
}
