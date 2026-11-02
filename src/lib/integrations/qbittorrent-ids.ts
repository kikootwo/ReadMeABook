/**
 * Component: qBittorrent Torrent IDs
 * Documentation: documentation/phase3/qbittorrent.md
 *
 * qBittorrent identifies a torrent by its v1 info hash, or by the first 40 hex characters
 * of its v2 info hash when it has one (hybrid and v2 torrents on libtorrent 2 builds).
 * A magnet added by its v1 hash switches to the v2 form once the metadata shows a hybrid.
 * Lookups therefore match the reported `hash` or `infohash_v1`.
 */

import { candidateIds, normalizeTorrentId, validTorrentId, type TorrentHashes } from './torrent-ids';

export * from './torrent-ids';

/** The fields of a /torrents/info entry that identify it */
export interface ClientTorrent {
  hash?: unknown;
  infohash_v1?: unknown;
}

/** One /torrents/info answer as a list: filtered by `hashes`, or the whole list when omitted */
export type TorrentLister<T> = (hashes?: string) => Promise<T[]>;

/** The ID qBittorrent uses on libtorrent 2 builds: truncated v2 when there is one, else v1 */
export function qbittorrentId(hashes: TorrentHashes): string {
  return candidateIds(hashes)[0];
}

/** The pre-add check could not read the client's torrent list, so nothing was added */
export class TorrentListUnavailableError extends Error {
  constructor() {
    super("Couldn't read qBittorrent's torrent list to check for an existing copy");
    this.name = 'TorrentListUnavailableError';
  }
}

/** Whether a /torrents/info entry is the torrent with one of these IDs (its `hash` or `infohash_v1`) */
export function isSameTorrent(torrent: ClientTorrent | null | undefined, ids: string[]): boolean {
  if (!torrent || typeof torrent !== 'object') return false;
  const own = [torrent.hash, torrent.infohash_v1]
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .map((value) => value.toLowerCase());
  return ids.some((id) => own.includes(id.toLowerCase()));
}

/**
 * The ID a /torrents/add answer confirms, or null when it does not confirm the add.
 * - Legacy `Ok.` (up to 5.1): the v1 hash, which libtorrent 1.2 builds use as the ID;
 *   the caller may look up the v2 form afterwards.
 * - 5.2+ receipt: exactly one success, no failures or pending adds, and its one ID is one
 *   of this torrent's candidate IDs.
 */
export function acceptedAddId(data: unknown, hashes: TorrentHashes): string | null {
  if (data === 'Ok.') return hashes.v1 ?? qbittorrentId(hashes);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const receipt = data as Record<string, unknown>;
  const ids = receipt.added_torrent_ids;
  if (
    receipt.success_count !== 1 ||
    receipt.failure_count !== 0 ||
    receipt.pending_count !== 0 ||
    !Array.isArray(ids) ||
    ids.length !== 1 ||
    typeof ids[0] !== 'string'
  ) {
    return null;
  }
  const id = ids[0].toLowerCase();
  return candidateIds(hashes).some((candidate) => candidate.toLowerCase() === id) ? id : null;
}

/** Stored ID → qBittorrent's current ID, learned from lookups. Bounded: the oldest entry goes first. */
export class TorrentIdMap {
  private readonly entries = new Map<string, string>();

  constructor(private readonly limit = 5000) {}

  get(id: string): string | undefined {
    return this.entries.get(id.toLowerCase());
  }

  /** Remembers a 40-hex client ID only */
  set(id: string, clientId: unknown): void {
    const value = validTorrentId(clientId);
    if (!value) return;
    const key = id.toLowerCase();
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
  }

  delete(id: string): void {
    this.entries.delete(id.toLowerCase());
  }
}

/** Runs one request at a time: concurrent callers share the pending one */
export class SharedRequest<T> {
  private pending: Promise<T> | null = null;

  run(request: () => Promise<T>): Promise<T> {
    this.pending ??= request().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}

/**
 * Finds the torrent matching any of `ids`: each query filtered (`hashes=`), then, when every
 * filtered answer was an empty list and `scan` is set, one unfiltered lookup. qBittorrent's
 * filter matches its current ID only, so a hybrid stored by its v1 hash needs the full list.
 */
export async function findTorrent<T extends ClientTorrent>(
  queries: string[],
  ids: string[],
  list: TorrentLister<T>,
  scan: boolean
): Promise<T | null> {
  let allEmpty = true;
  for (const query of queries) {
    const answer = await list(query);
    const match = answer.find((torrent) => isSameTorrent(torrent, ids));
    if (match) return match;
    if (answer.length > 0) allEmpty = false;
  }
  if (!scan || !allEmpty) return null;
  return (await list()).find((torrent) => isSameTorrent(torrent, ids)) ?? null;
}

/** Looks up a stored ID (base32 normalized; a learned client ID first) and remembers the client's ID */
export async function lookupTorrent<T extends ClientTorrent>(
  id: string,
  known: TorrentIdMap,
  list: TorrentLister<T>,
  scan: boolean
): Promise<T | null> {
  const stored = normalizeTorrentId(id);
  const query = known.get(stored) ?? stored;
  const match = await findTorrent([query], [query, stored], list, scan);
  if (match) known.set(stored, match.hash);
  return match;
}
