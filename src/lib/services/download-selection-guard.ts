/**
 * Component: Download Selection Guard (client-supplied download selections)
 * Documentation: documentation/phase3/download-clients.md
 *
 * - Torrent/NZB selections: downloadUrl must be a magnet URI or a Prowlarr
 *   proxy-download URL (`/{indexerId}/download`), always rewritten onto the
 *   configured Prowlarr origin and base path.
 * - Magnets an admin adds by hand (Add Torrent): the same rule plus exactly one v1 hash.
 * - Anna's Archive selections: only the md5 is trusted; links are rebuilt server-side.
 * - Search responses: the Prowlarr API key is stripped (by value) before leaving the server.
 */

import { NextResponse } from 'next/server';
import { getProwlarrConnection } from '@/lib/integrations/prowlarr-connection';
import { isMagnetUri, stripApiKey, toConfiguredProwlarrUrl } from '@/lib/utils/prowlarr-url';
import { decodedMagnet } from '@/lib/integrations/torrent-ids';
import { MAX_MAGNET_BODY_BYTES } from '@/lib/constants/download-source';

export const DEFAULT_ANNAS_ARCHIVE_BASE_URL = 'https://annas-archive.gl';

export const UNTRUSTED_DOWNLOAD_URL_MESSAGE =
  'Download URL must be a magnet link or a download link from the configured Prowlarr server';

const MD5_PATTERN = /^[a-f0-9]{32}$/i;

/** `retryable`: the source could not be reached right now (the pick itself may be fine) */
export type GuardResult<T> = { ok: true; value: T } | { ok: false; error: string; retryable?: boolean };

export const SOURCE_UNAVAILABLE_MESSAGE = "Couldn't reach Anna's Archive to prepare this download. Try again in a moment.";

/**
 * Accept a magnet as-is, or a Prowlarr download link rewritten onto the configured
 * Prowlarr base (see `toConfiguredProwlarrUrl`); anything else is rejected.
 */
export async function checkClientDownloadUrl(url: unknown): Promise<GuardResult<string>> {
  if (typeof url !== 'string' || url.trim() === '') return { ok: false, error: 'Download URL is required' };
  if (isMagnetUri(url)) return { ok: true, value: url };
  const { base } = await getProwlarrConnection();
  const rewritten = toConfiguredProwlarrUrl(url, base);
  return rewritten ? { ok: true, value: rewritten } : { ok: false, error: UNTRUSTED_DOWNLOAD_URL_MESSAGE };
}

const MAGNET_HASH_PARAM = /[?&]xt(?:\.\d+)?=urn:(btih|btmh):([^&]*)/gi; // the params magnetHashes reads
const BTIH_VALUE = /^(?:[0-9a-f]{40}|[a-z2-7]{32})$/i;

/**
 * A magnet an admin adds to a request by hand: the shared rule (`checkClientDownloadUrl`), and
 * strictly one torrent: at most 16 KiB, no control characters, exactly one btih (`xt` or `xt.N`) of
 * 40 hex or 32 base32 characters, at most one btmh. The value is the magnet with `&amp;` read as `&`
 * (what every client is sent), otherwise the string as given.
 */
export async function checkAddableMagnet(url: unknown): Promise<GuardResult<string>> {
  if (typeof url !== 'string' || url.trim() === '') return { ok: false, error: 'Paste a magnet link' };
  if (Buffer.byteLength(url, 'utf8') > MAX_MAGNET_BODY_BYTES) return { ok: false, error: 'This magnet link is too long' };
  if (/[\x00-\x1f\x7f]/.test(url) || !isMagnetUri(url)) return { ok: false, error: 'This is not a magnet link' };
  const shared = await checkClientDownloadUrl(url);
  if (!shared.ok) return shared;

  const magnet = decodedMagnet(shared.value);
  const params = [...magnet.matchAll(MAGNET_HASH_PARAM)];
  const btih = params.filter(([, kind]) => kind.toLowerCase() === 'btih');
  const btmh = params.length - btih.length;
  if (btih.length > 1 || btmh > 1) return { ok: false, error: 'This magnet link names more than one torrent' };
  if (btih.length === 0) {
    return { ok: false, error: btmh ? 'This magnet link has no BitTorrent v1 hash (btih); use the .torrent file' : 'This magnet link has no info hash' };
  }
  if (!BTIH_VALUE.test(btih[0][2])) return { ok: false, error: "This magnet link's info hash is not valid" };
  return { ok: true, value: magnet };
}

/** Validate a client- or DB-supplied torrent/NZB selection (downloadUrl normalized onto the configured base). */
export async function guardTorrentSelection<T extends { downloadUrl?: unknown }>(
  selection: T | null | undefined
): Promise<GuardResult<T>> {
  if (!selection || typeof selection !== 'object') return { ok: false, error: 'Torrent data is required' };
  const url = await checkClientDownloadUrl(selection.downloadUrl);
  return url.ok ? { ok: true, value: { ...selection, downloadUrl: url.value } } : url;
}

/** Rebuild Anna's Archive download links from the md5 using the configured base URL. */
export async function resolveAnnasArchiveLinks(md5: unknown): Promise<GuardResult<{ md5: string; downloadUrls: string[] }>> {
  if (typeof md5 !== 'string' || !MD5_PATTERN.test(md5)) {
    return { ok: false, error: "Invalid Anna's Archive selection" };
  }
  const normalized = md5.toLowerCase();
  const { getConfigService } = await import('@/lib/services/config.service');
  const { getSlowDownloadLinks } = await import('@/lib/services/ebook-scraper');
  const configService = getConfigService();
  const baseUrl = (await configService.get('ebook_sidecar_base_url')) || DEFAULT_ANNAS_ARCHIVE_BASE_URL;
  const flaresolverrUrl = (await configService.get('ebook_sidecar_flaresolverr_url')) || undefined;
  let downloadUrls: string[];
  try {
    downloadUrls = await getSlowDownloadLinks(normalized, baseUrl, undefined, flaresolverrUrl, { throwOnError: true });
  } catch {
    return { ok: false, error: SOURCE_UNAVAILABLE_MESSAGE, retryable: true };
  }
  if (downloadUrls.length === 0) {
    return { ok: false, error: "No Anna's Archive download links are available for this e-book right now" };
  }
  return { ok: true, value: { md5: normalized, downloadUrls } };
}

/**
 * Validate an e-book selection. Anna's Archive selections get their links
 * replaced by server-built ones; indexer selections get the URL check.
 */
export async function guardEbookSelection<
  T extends { source?: unknown; md5?: unknown; downloadUrl?: unknown; downloadUrls?: unknown }
>(selection: T | null | undefined): Promise<GuardResult<T>> {
  if (!selection || typeof selection !== 'object') return { ok: false, error: 'No ebook selected' };
  if (selection.source === 'annas_archive') {
    const links = await resolveAnnasArchiveLinks(selection.md5);
    if (!links.ok) return links;
    return {
      ok: true,
      value: { ...selection, md5: links.value.md5, downloadUrl: links.value.downloadUrls[0], downloadUrls: links.value.downloadUrls },
    };
  }
  if (selection.source === 'prowlarr') return guardTorrentSelection(selection);
  return { ok: false, error: 'Ebook source not specified' };
}

/** 400 response for a rejected selection. */
export function rejectedSelectionResponse(message: string): NextResponse {
  return NextResponse.json({ error: 'ValidationError', message }, { status: 400 });
}

/** 503 when the source could not be reached (try again), otherwise 400. */
export function selectionFailureResponse(result: { error: string; retryable?: boolean }): NextResponse {
  if (result.retryable) {
    return NextResponse.json({ error: 'SourceUnavailable', message: result.error }, { status: 503 });
  }
  return rejectedSelectionResponse(result.error);
}

function stripDeep(value: unknown, apiKey: string): unknown {
  if (typeof value === 'string') return stripApiKey(value, apiKey);
  if (Array.isArray(value)) return value.map((item) => stripDeep(item, apiKey));
  if (value && Object.prototype.toString.call(value) === '[object Object]') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = stripDeep(item, apiKey);
    }
    return out;
  }
  return value;
}

/** Remove the configured Prowlarr key from every string in search results bound for the browser. */
export async function stripProwlarrKeyFromResults<T>(results: T): Promise<T> {
  const { apiKey } = await getProwlarrConnection();
  return apiKey ? (stripDeep(results, apiKey) as T) : results;
}
