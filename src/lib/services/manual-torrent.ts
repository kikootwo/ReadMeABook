/**
 * Component: Manual Torrent (admin Add Torrent: a magnet link or a .torrent file)
 * Documentation: documentation/phase3/manual-torrent-download.md
 *
 * - readUploadedTorrent: a base64 .torrent, parsed in memory only (never a path, URL or file name)
 * - torrentTitle: the name shown in history, notifications and logs (control characters removed)
 * - manualTorrentResult: the release a download job carries; label "Manual", no indexer id
 */

import * as parseTorrentModule from 'parse-torrent';
import { MAX_UPLOADED_TORRENT_BYTES } from '@/lib/constants/download-source';
import { isWellFormedTorrentFile } from '@/lib/integrations/torrent-file-check';
import { torrentFileHashes } from '@/lib/integrations/torrent-ids';
import type { TorrentResult } from '@/lib/utils/ranking-algorithm';

// Handle both ESM and CommonJS imports
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseTorrent = (parseTorrentModule as any).default || parseTorrentModule;

/** Indexer label of a hand-added torrent: no indexer config matches it, so it seeds until removed in the client */
export const MANUAL_TORRENT_INDEXER = 'Manual';

export const INVALID_TORRENT_FILE_MESSAGE = 'Not a valid .torrent file.';

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_BASE64_CHARS = Math.ceil(MAX_UPLOADED_TORRENT_BYTES / 3) * 4;
const MAX_TITLE_CHARS = 255;

export interface UploadedTorrent {
  /** The file's bytes, exactly as uploaded */
  data: Buffer;
  /** v1 info hash (40 lowercase hex) */
  infoHash: string;
  title: string;
  /** Total length of the torrent's files (bytes) */
  size: number;
}

export type UploadCheck = { ok: true; value: UploadedTorrent } | { ok: false; error: string };

type ParsedTorrent = {
  info?: Record<string, unknown>;
  infoBuffer?: Uint8Array;
  infoHash?: string;
  name?: string;
  length?: number;
  files?: { length?: unknown }[];
};

const safeLength = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;

/**
 * A .torrent file sent as base64. Accepted only when it decodes to at most 2 MiB, has a well-formed
 * structure (`isWellFormedTorrentFile`, checked before any parse) and parses to a
 * real metainfo file: an info dict and its bytes, and a total length (and file lengths) that is a
 * safe non-negative integer. A 20-byte buffer (parse-torrent reads it as a bare info hash) has no
 * info dict, so it is refused.
 */
export async function readUploadedTorrent(base64: string): Promise<UploadCheck> {
  if (base64.length > MAX_BASE64_CHARS) return { ok: false, error: 'This .torrent file is larger than 2 MB.' };
  if (base64.length % 4 !== 0 || !BASE64.test(base64)) return { ok: false, error: INVALID_TORRENT_FILE_MESSAGE };
  const data = Buffer.from(base64, 'base64');
  if (data.length > MAX_UPLOADED_TORRENT_BYTES) return { ok: false, error: 'This .torrent file is larger than 2 MB.' };
  // Structure check first (shared with fetched files): only a well-formed file reaches parse-torrent
  if (!isWellFormedTorrentFile(data)) return { ok: false, error: INVALID_TORRENT_FILE_MESSAGE };

  let parsed: ParsedTorrent;
  try {
    parsed = await parseTorrent(data);
  } catch {
    return { ok: false, error: INVALID_TORRENT_FILE_MESSAGE }; // bad bencode, missing fields, too deep (RangeError)
  }
  const valid = !!parsed?.info && !!parsed.infoBuffer && safeLength(parsed.length)
    && (parsed.files ?? []).every((file) => safeLength(file.length));
  const hashes = valid ? torrentFileHashes(parsed) : null;
  if (!hashes?.v1) return { ok: false, error: INVALID_TORRENT_FILE_MESSAGE };

  return { ok: true, value: { data, infoHash: hashes.v1, title: torrentTitle(parsed.name, hashes.v1), size: parsed.length! } };
}

/** A torrent's display name: control characters removed, whitespace collapsed, at most 255 characters */
export function torrentTitle(raw: unknown, infoHash: string): string {
  const cleaned = typeof raw === 'string'
    ? raw.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  const title = [...cleaned].slice(0, MAX_TITLE_CHARS).join('').trim();
  return title || `Manual torrent ${infoHash.slice(0, 8)}`;
}

/** A magnet's query parameters (`dn`, `xl`), read with URLSearchParams (a bad %-escape never throws) */
function magnetParams(magnet: string): URLSearchParams {
  return new URLSearchParams(magnet.slice(magnet.indexOf('?') + 1));
}

/** `xt` + an encoded `dn`: the magnet stored for a file add (Retry Download, history), no trackers */
export function bareMagnet(infoHash: string, title: string): string {
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`;
}

/** The release a hand-added magnet's download job carries (the magnet as checked, never rebuilt) */
export function manualMagnetResult(magnet: string, infoHash: string): TorrentResult {
  const params = magnetParams(magnet);
  const length = Number(params.get('xl'));
  return manualResult(magnet, infoHash, torrentTitle(params.get('dn'), infoHash), safeLength(length) ? length : 0);
}

/** The release a hand-added .torrent file's job carries: the bytes travel beside it, never on it */
export function manualFileResult(file: UploadedTorrent): TorrentResult {
  return manualResult(bareMagnet(file.infoHash, file.title), file.infoHash, file.title, file.size);
}

function manualResult(magnet: string, infoHash: string, title: string, size: number): TorrentResult {
  return {
    indexer: MANUAL_TORRENT_INDEXER,
    title,
    size,
    publishDate: new Date(),
    downloadUrl: magnet,
    guid: magnet, // a magnet guid keeps "View Source" hidden (no indexer page)
    infoHash,
    protocol: 'torrent',
    format: 'OTHER',
  };
}
