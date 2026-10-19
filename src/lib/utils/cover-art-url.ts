/**
 * Component: Cover Art URL Rules
 * Documentation: documentation/phase3/file-organization.md
 *
 * Two rules:
 * - Stored/displayed covers (`sanitizeCoverArtUrl`): any http(s) URL or a cached
 *   thumbnail path. Shelf-sync fallbacks (Goodreads, Hardcover) stay visible.
 * - Fetched/copied into the library (file organizer): only a cached thumbnail with a
 *   plain file name, or https on a known Audible/Amazon image host (every redirect hop too).
 */

import path from 'path';

/** On-disk cache for Audible cover thumbnails (served at THUMBNAIL_API_PREFIX) */
export const THUMBNAIL_CACHE_DIR = '/app/cache/thumbnails';
export const THUMBNAIL_API_PREFIX = '/api/cache/thumbnails/';

/** Image hosts used by Audible and Audnexus cover art (exact host or subdomain) */
export const COVER_ART_HOSTS = ['media-amazon.com', 'ssl-images-amazon.com', 'images-amazon.com'];

/** Max size of a downloaded cover image (bytes) */
export const MAX_COVER_ART_BYTES = 20 * 1024 * 1024;

/** Redirects followed when downloading a cover (e.g. legacy images-na → m.media-amazon) */
export const MAX_COVER_ART_REDIRECTS = 3;

const CACHE_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** True for a cached-thumbnail file name that cannot leave the cache dir. */
export function isSafeThumbnailFilename(filename: string): boolean {
  return CACHE_FILE_PATTERN.test(filename) && !filename.includes('..');
}

/** Absolute path of a cached thumbnail for `/api/cache/thumbnails/<file>`, or null if not that form. */
export function cachedThumbnailPath(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(THUMBNAIL_API_PREFIX)) return null;
  const filename = url.slice(THUMBNAIL_API_PREFIX.length);
  return isSafeThumbnailFilename(filename) ? path.join(THUMBNAIL_CACHE_DIR, filename) : null;
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** True for an https URL on a known cover image host (no credentials). */
export function isAllowedRemoteCoverUrl(url: string | null | undefined): boolean {
  const parsed = url ? parseUrl(url) : null;
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  return COVER_ART_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** True when the file organizer may copy/download this cover into the library. */
export function isLibraryCoverSource(url: string | null | undefined): boolean {
  return cachedThumbnailPath(url) !== null || isAllowedRemoteCoverUrl(url);
}

/** Keep a cover URL for storage/display only when it is http(s) or a safe cached-thumbnail path. */
export function sanitizeCoverArtUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (cachedThumbnailPath(url)) return url;
  const parsed = parseUrl(url);
  return parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? url : undefined;
}
