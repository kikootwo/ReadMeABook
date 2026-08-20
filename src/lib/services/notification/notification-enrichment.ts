/**
 * Component: Notification Book Enrichment
 * Documentation: documentation/backend/services/notifications.md
 *
 * Builds rich book metadata (cover, narrator, series, year, genres, duration, description) for
 * embed-capable notification providers. Pure DB lookups (Audiobook + AudibleCache) — never touches
 * the Discord bot or any external API, so notifications stay rich even when the bot is disabled.
 */

import { prisma } from '../../db';
import { RMABLogger } from '../../utils/logger';
import type { NotificationBookMeta } from './INotificationProvider';

const logger = RMABLogger.create('NotificationEnrichment');

/** Coerce a stored JSON genres value into a clean string[] (defensive against bad data). */
function normalizeGenres(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const genres = value.filter((g): g is string => typeof g === 'string' && g.trim().length > 0);
  return genres.length > 0 ? genres : null;
}

/**
 * Load rich book metadata for a request. Joins the request's audiobook for cover/narrator/series/
 * year/description, then fills genres + duration (and any missing fields) from the AudibleCache row.
 * Returns undefined when there's nothing to enrich (no requestId, request not found, or all empty) —
 * callers should treat enrichment as best-effort and never block the notification on it.
 */
export async function enrichBookMeta(requestId?: string): Promise<NotificationBookMeta | undefined> {
  if (!requestId) return undefined;

  try {
    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { audiobook: true },
    });

    const book = request?.audiobook;
    if (!book) return undefined;

    const meta: NotificationBookMeta = {
      coverArtUrl: book.coverArtUrl ?? null,
      narrator: book.narrator ?? null,
      series: book.series ?? null,
      seriesPart: book.seriesPart ?? null,
      year: book.year ?? null,
      description: book.description ?? null,
      genres: null,
      durationMinutes: null,
    };

    // AudibleCache carries genres + runtime that aren't stored on the Audiobook row.
    if (book.audibleAsin) {
      const cache = await prisma.audibleCache.findUnique({ where: { asin: book.audibleAsin } });
      if (cache) {
        meta.genres = normalizeGenres(cache.genres);
        meta.durationMinutes = cache.durationMinutes ?? null;
        meta.coverArtUrl = meta.coverArtUrl ?? cache.coverArtUrl ?? null;
        meta.narrator = meta.narrator ?? cache.narrator ?? null;
        meta.description = meta.description ?? cache.description ?? null;
      }
    }

    return meta;
  } catch (error) {
    logger.warn('Failed to enrich notification book metadata', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
