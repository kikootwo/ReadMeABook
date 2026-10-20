/**
 * Component: Organize Tag Details (Audible details for series backfill and metadata tags)
 * Documentation: documentation/phase3/file-organization.md
 */

import { prisma } from '../db';
import type { RMABLogger } from '../utils/logger';
import { getAudibleService, type AudibleAudiobook } from '../integrations/audible.service';
import { stripHtml } from '../utils/strip-html';
import { truncateRawText } from '../utils/metadata-text';

export type AudibleDetailsLoader = () => Promise<AudibleAudiobook | null>;

/** Description and genres written into the audio file tags. */
export interface TagDetails {
  description?: string;
  genres?: string[];
}

/** Longest wait for a lookup that only serves the tags (the series backfill awaits it in full). */
export const TAG_DETAILS_TIMEOUT_MS = 15_000;

/**
 * The import's one read of `metadata_tagging_enabled`, passed to the details lookup
 * and the organizer. A failed read is undefined: no lookup, and the organizer reads
 * (and reports) the setting itself.
 */
export async function readMetadataTaggingEnabled(logger: RMABLogger): Promise<boolean | undefined> {
  try {
    const config = await prisma.configuration.findUnique({ where: { key: 'metadata_tagging_enabled' } });
    return config?.value === 'true';
  } catch (error) {
    logger.warn(`Could not read metadata_tagging_enabled for tag details: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/**
 * At most one Audible details lookup per import, shared by the series backfill and
 * the metadata tags. Resolves to null without an ASIN; never called until needed.
 */
export function createAudibleDetailsLoader(asin: string | null | undefined): AudibleDetailsLoader {
  let pending: Promise<AudibleAudiobook | null> | undefined;
  return () => {
    if (!asin) return Promise.resolve(null);
    pending ??= getAudibleService().getAudiobookDetails(asin);
    return pending;
  };
}

/**
 * Description and genres for the metadata tags, only when tagging is on. Prefers the
 * full Audible summary, falls back to the stored description. The lookup is raced
 * against `timeoutMs` (a lookup the series backfill already awaited is settled, so
 * that path is unchanged); a failed or slow lookup never blocks the import: the
 * book is tagged with the stored description and no genres.
 */
export async function resolveTagDetails(
  storedDescription: string | null | undefined,
  loadDetails: AudibleDetailsLoader,
  taggingEnabled: boolean | undefined,
  logger: RMABLogger,
  timeoutMs: number = TAG_DETAILS_TIMEOUT_MS
): Promise<TagDetails> {
  if (!taggingEnabled) return {};

  let details: AudibleAudiobook | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const outcome = await Promise.race([loadDetails(), timedOut]);
    if (outcome === 'timeout') {
      logger.warn(`Audible details lookup for metadata tags took over ${timeoutMs / 1000} s; tagging with the stored description and no genres`);
    } else {
      details = outcome;
    }
  } catch (error) {
    logger.warn(`Failed to fetch Audible details for metadata tags: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }

  // The stored description is client text (older rows, or any request body): bounded, then HTML stripped like the lookup's
  const description = details?.description || (storedDescription ? stripHtml(truncateRawText(storedDescription)) : '') || undefined;
  const genres = details?.primaryGenres?.length ? details.primaryGenres : undefined;

  logger.info(`Metadata tag details: description=${description ? `${description.length} chars` : 'none'}, genres=${genres ? genres.join(', ') : 'none'}`);

  return { description, genres };
}
