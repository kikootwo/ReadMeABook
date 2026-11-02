/**
 * Component: The library cover follows an Audiobookshelf rematch (#325a, #284 part B)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * ABS serves an item's cover at a fixed URL (/api/items/<id>/cover), and the cache keeps a file
 * once it exists, so a rematched item kept its old cover. ABS covers are now cached as
 * `<hash>-<ASIN>.<ext>` (the item's ASIN when cached). When a scan sees the item's ASIN change,
 * it downloads the cover again under the new name and deletes the old file: a new name is a new
 * URL, so neither the browser nor Next's image cache serves the old picture. An unchanged ASIN
 * reuses the file (legacy `<hash>.<ext>` names too). Plex: unchanged.
 */

import type { ThumbnailCacheService } from '../thumbnail-cache.service';
import { asinShaped, sameAsin } from '@/lib/utils/asin';

export interface CoverCachingParams {
  backendBaseUrl: string;
  authToken: string;
  backendMode: 'plex' | 'audiobookshelf';
}

/** What a scan knew about the item before this scan (its plex_library row), if anything. */
export interface PreviousLibraryRow {
  asin: string | null;
  cachedLibraryCoverPath: string | null;
}

export interface LibraryCoverPlan {
  variant?: string;
  refresh: boolean;
}

/** The ASIN in an ABS cover file name, or null (legacy or Plex name, no cover). */
export function coverAsinOf(cachedPath: string | null | undefined): string | null {
  const match = cachedPath?.split(/[\\/]/).pop()?.match(/^[0-9a-f]{16}-([A-Z0-9]{10})\.[^.]+$/);
  return match ? match[1] : null;
}

/** The cache file variant for this item and whether its cover must be fetched again. */
export function libraryCoverPlan(
  backendMode: string,
  itemAsin: string | null | undefined,
  previous: PreviousLibraryRow | null | undefined
): LibraryCoverPlan {
  if (backendMode !== 'audiobookshelf') return { refresh: false };
  const asin = asinShaped(itemAsin)?.toUpperCase() ?? null;
  const coverAsin = coverAsinOf(previous?.cachedLibraryCoverPath);
  if (!asin) return { variant: coverAsin ?? undefined, refresh: false };
  if (!previous?.cachedLibraryCoverPath) return { variant: asin, refresh: false };
  const cachedFor = coverAsin ?? asinShaped(previous.asin);
  if (sameAsin(cachedFor, asin)) return { variant: coverAsin ?? undefined, refresh: false };
  return { variant: asin, refresh: true };
}

/**
 * Cache the item's cover. Returns the path to store, null to clear the stored one (a rematched
 * item whose new cover could not be fetched: no card pairs the new edition with the old cover),
 * or undefined to leave the row as it is.
 */
export async function cacheLibraryCover(
  service: Pick<ThumbnailCacheService, 'cacheLibraryThumbnail' | 'deleteLibraryThumbnail'>,
  params: CoverCachingParams,
  item: { externalId: string; coverUrl?: string | null; asin?: string | null },
  previous: PreviousLibraryRow | null
): Promise<string | null | undefined> {
  const plan = libraryCoverPlan(params.backendMode, item.asin, previous);
  let cached: string | null = null;
  if (item.coverUrl && item.externalId) {
    const args = [item.externalId, item.coverUrl, params.backendBaseUrl, params.authToken, params.backendMode] as const;
    cached = plan.variant || plan.refresh
      ? await service.cacheLibraryThumbnail(...args, plan)
      : await service.cacheLibraryThumbnail(...args);
  }
  if (!plan.refresh) return cached ?? undefined;
  const old = previous?.cachedLibraryCoverPath;
  if (old && old !== cached) await service.deleteLibraryThumbnail(old);
  return cached;
}
