/**
 * Component: qBittorrent Torrent IDs
 * Documentation: documentation/phase3/qbittorrent.md
 *
 * qBittorrent identifies a torrent by its v1 info hash, or by the first 40 hex characters
 * of its v2 info hash when it has one (hybrid and v2 torrents on libtorrent 2 builds).
 * A magnet added by its v1 hash switches to the v2 form once the metadata shows a hybrid.
 * Lookups therefore match the reported `hash` or `infohash_v1`.
 */

import { createHash } from 'node:crypto';

/** Lowercase hex info hashes: v1 = 40 chars (SHA-1), v2 = 64 chars (SHA-256) */
export interface TorrentHashes {
  v1?: string;
  v2?: string;
}

/** The fields of a /torrents/info entry that identify it */
export interface ClientTorrent {
  hash?: unknown;
  infohash_v1?: unknown;
}

/** One /torrents/info answer as a list: filtered by `hashes`, or the whole list when omitted */
export type TorrentLister<T> = (hashes?: string) => Promise<T[]>;

const HEX40 = /^[0-9a-f]{40}$/i;
const BASE32 = /^[a-z2-7]{32}$/i;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A 40-hex torrent ID, lowercased; anything else (a list, `all`, a non-hex value) is null */
export function validTorrentId(value: unknown): string | null {
  return typeof value === 'string' && HEX40.test(value) ? value.toLowerCase() : null;
}

/** RFC 4648 base32 (32 characters, any case) to 40 lowercase hex characters */
export function base32ToHex(value: string): string | null {
  if (!BASE32.test(value)) return null;
  let bits = 0;
  let acc = 0;
  let hex = '';
  for (const char of value.toUpperCase()) {
    acc = ((acc << 5) | BASE32_ALPHABET.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      hex += ((acc >>> bits) & 0xff).toString(16).padStart(2, '0');
    }
  }
  return hex;
}

/** RFC 4648 base32 (upper case) of 40 hex characters */
export function hexToBase32(hex: string): string {
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const byte of Buffer.from(hex, 'hex')) {
    acc = ((acc << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(acc >>> bits) & 31];
    }
  }
  return out;
}

/** A magnet link with HTML-escaped separators (`&amp;`) read as `&` */
export function decodedMagnet(magnetUrl: string): string {
  return magnetUrl.replace(/&amp;/gi, '&');
}

/** v1 (`btih`, hex or base32) and v2 (`btmh` SHA-256 multihash) hashes of a magnet link (`&amp;` read as `&`) */
export function magnetHashes(magnetUrl: string): TorrentHashes | null {
  const hashes: TorrentHashes = {};
  for (const [, kind, value] of decodedMagnet(magnetUrl).matchAll(/[?&]xt(?:\.\d+)?=urn:(btih|btmh):([0-9a-z]+)/gi)) {
    if (kind.toLowerCase() === 'btmh') {
      if (/^1220[0-9a-f]{64}/i.test(value)) hashes.v2 ??= value.slice(4, 68).toLowerCase();
    } else if (/^[0-9a-f]{40}/i.test(value)) {
      hashes.v1 ??= value.slice(0, 40).toLowerCase();
    } else {
      hashes.v1 ??= base32ToHex(value) ?? undefined;
    }
  }
  return hashes.v1 || hashes.v2 ? hashes : null;
}

/** v1 hash from parse-torrent; v2 = SHA-256 of the info dict when it declares `meta version` 2 */
export function torrentFileHashes(parsed: {
  infoHash?: string;
  info?: Record<string, unknown>;
  infoBuffer?: Uint8Array;
} | null | undefined): TorrentHashes | null {
  if (!parsed?.infoHash) return null;
  const isV2 = parsed.info?.['meta version'] === 2 && parsed.infoBuffer;
  return {
    v1: parsed.infoHash,
    v2: isV2 ? createHash('sha256').update(parsed.infoBuffer!).digest('hex') : undefined,
  };
}

/** The ID qBittorrent uses on libtorrent 2 builds: truncated v2 when there is one, else v1 */
export function qbittorrentId(hashes: TorrentHashes): string {
  return hashes.v2 ? hashes.v2.slice(0, 40) : hashes.v1!;
}

/** Every ID the torrent may have in qBittorrent: [libtorrent 2 ID, v1] without duplicates */
export function candidateIds(hashes: TorrentHashes): string[] {
  return [...new Set([qbittorrentId(hashes), hashes.v1].filter((id): id is string => !!id))];
}

/** A stored base32 hash (any case) as hex; any other value unchanged */
export function normalizeTorrentId(id: string): string {
  return base32ToHex(id) ?? id;
}

/** A stored torrent hash in every form a row may hold it: as given, hex, and lower-case base32 */
export function torrentHashForms(hash: string): string[] {
  const hex = validTorrentId(normalizeTorrentId(hash));
  return [...new Set([hash, ...(hex ? [hex, hexToBase32(hex).toLowerCase()] : [])])];
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
