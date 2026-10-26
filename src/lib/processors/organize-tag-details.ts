/**
 * Component: Organize Tag Details (Audible details for series backfill and metadata tags)
 * Documentation: documentation/phase3/file-organization.md
 */

import { prisma } from '../db';
import type { RMABLogger } from '../utils/logger';
import { getAudibleService, type AudibleAudiobook } from '../integrations/audible.service';
import { stripHtml } from '../utils/strip-html';
import { bookDetailValues, truncateRawText } from '../utils/metadata-text';

export type AudibleDetailsLoader = () => Promise<AudibleAudiobook | null>;

/** Description, genres, publisher, subtitle and language written into the audio file tags. */
export interface TagDetails {
  description?: string;
  genres?: string[];
  publisher?: string;
  subtitle?: string;
  language?: string;
}

/** Longest tag value shown in the job log (the tagger caps what it writes). */
const MAX_LOGGED_VALUE_LENGTH = 100;

const textOrUndefined = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

const logValue = (value: string | undefined): string =>
  value === undefined ? 'none' : value.length > MAX_LOGGED_VALUE_LENGTH ? `${truncateRawText(value, MAX_LOGGED_VALUE_LENGTH)}…` : value;

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
 * The tag details, only when tagging is on. Prefers the full Audible summary, falls
 * back to the stored description; genres, publisher, subtitle and language come
 * from the lookup only (the book row stores none of them). The lookup is raced
 * against `timeoutMs` (a lookup the series backfill already awaited is settled, so
 * that path is unchanged); a failed or slow lookup never blocks the import: the
 * book is tagged with the stored description and nothing from Audible.
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
      logger.warn(`Audible details lookup for metadata tags took over ${timeoutMs / 1000} s; tagging with the stored description, without genres, publisher, subtitle or language`);
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
  // Lookup data is external: anything but a non-empty string is no value
  const publisher = textOrUndefined(details?.publisherName);
  const subtitle = textOrUndefined(details?.subtitle);
  const language = textOrUndefined(details?.language);
  // The log shows what the tagger writes (sanitized: one line, "English"), not the raw lookup strings
  const shown = bookDetailValues({ publisher, subtitle, language });

  logger.info(
    `Metadata tag details: description=${description ? `${description.length} chars` : 'none'}, genres=${genres ? genres.join(', ') : 'none'}, ` +
      `publisher=${logValue(shown.publisher)}, subtitle=${logValue(shown.subtitle)}, language=${logValue(shown.language)}`
  );

  return { description, genres, publisher, subtitle, language };
}
