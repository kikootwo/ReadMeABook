/**
 * Component: Torrent IDs (client-agnostic)
 * Documentation: documentation/phase3/download-clients.md
 *
 * Info hashes of magnets and .torrent files, base32/hex conversion, and the IDs a torrent
 * may have in a libtorrent-based client (v1, or the first 40 hex characters of v2 on
 * libtorrent 2). Shared by the qBittorrent, Transmission and Deluge services.
 */

import { createHash } from 'node:crypto';

/** Lowercase hex info hashes: v1 = 40 chars (SHA-1), v2 = 64 chars (SHA-256) */
export interface TorrentHashes {
  v1?: string;
  v2?: string;
}

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

/** Every ID the torrent may have in a libtorrent client: [libtorrent 2 ID (truncated v2, else v1), v1] without duplicates */
export function candidateIds(hashes: TorrentHashes): string[] {
  const libtorrent2Id = hashes.v2 ? hashes.v2.slice(0, 40) : hashes.v1;
  return [...new Set([libtorrent2Id, hashes.v1].filter((id): id is string => !!id))];
}

/**
 * The ID to record for a torrent a client's add just created: the 40-hex ID it reports (lowercased),
 * else the computed v1. A reported ID that is none of the candidate IDs is still the torrent the add
 * created (a multi-btih magnet, a non-canonical .torrent), so it is recorded, with a warning.
 */
export function addedTorrentId(reported: unknown, hashes: TorrentHashes, warn: (message: string) => void): string {
  const id = validTorrentId(reported);
  if (!id) return hashes.v1 ?? candidateIds(hashes)[0];
  if (!candidateIds(hashes).some((candidate) => candidate.toLowerCase() === id)) {
    warn(`The client reported ${id} for the torrent it added (computed ${candidateIds(hashes).join(', ')}): recorded as reported`);
  }
  return id;
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
