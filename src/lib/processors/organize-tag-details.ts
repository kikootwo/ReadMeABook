/**
 * Component: Organize Tag Details (Audible details for series backfill and metadata tags)
 * Documentation: documentation/phase3/file-organization.md
 */

import type { RMABLogger } from '../utils/logger';
import { getConfigService } from '../services/config.service';
import { getAudibleService, type AudibleAudiobook } from '../integrations/audible.service';

export type AudibleDetailsLoader = () => Promise<AudibleAudiobook | null>;

/** Description and genres written into the audio file tags. */
export interface TagDetails {
  description?: string;
  genres?: string[];
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
 * Description and genres for the metadata tags. Looked up only when metadata tagging
 * is on. Prefers the full Audible summary, falls back to the stored description.
 * A failed lookup never blocks the import: the book is tagged with what is stored.
 */
export async function resolveTagDetails(
  storedDescription: string | null | undefined,
  loadDetails: AudibleDetailsLoader,
  logger: RMABLogger
): Promise<TagDetails> {
  const taggingEnabled = (await getConfigService().get('metadata_tagging_enabled')) === 'true';
  if (!taggingEnabled) return {};

  let details: AudibleAudiobook | null = null;
  try {
    details = await loadDetails();
  } catch (error) {
    logger.warn(`Failed to fetch Audible details for metadata tags: ${error instanceof Error ? error.message : String(error)}`);
  }

  const description = details?.description || storedDescription || undefined;
  const genres = details?.primaryGenres?.length ? details.primaryGenres : undefined;

  logger.info(`Metadata tag details: description=${description ? `${description.length} chars` : 'none'}, genres=${genres ? genres.join(', ') : 'none'}`);

  return { description, genres };
}
