/**
 * Component: Audiobookshelf ASIN match + read-back
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * For ABS items listed without an ASIN: find the ASIN of an RMAB download with the same files
 * (file hash), ask ABS to match (exact ASIN or fuzzy), then store the ASIN ABS now holds on the
 * plex_library row at once, so request checks see it in the same scan (#287).
 * Shared by the full library scan and the recently-added check.
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import { generateFilesHash } from '@/lib/utils/files-hash';
import type { LibraryItem } from '@/lib/services/library/ILibraryService';
import { getABSItem, triggerABSItemMatch, type ABSMatchOutcome } from './api';

/** Audible ASINs are 10 alphanumerics (B0..., or ISBN-10 style digits for some titles). */
const ASIN_PATTERN = /^[A-Z0-9]{10}$/i;

export interface MatchMissingAsinsResult {
  /** Items listed without an ASIN (the ones a match was attempted for) */
  considered: number;
  fileMatchCount: number;
  fuzzyMatchCount: number;
  /** plex_library rows that got an ASIN from the match response */
  asinsStored: number;
  /** ...of which already held a different ASIN */
  asinsChanged: number;
}

/**
 * The ASIN ABS holds after a match, or null when there is none or it isn't ASIN-shaped.
 * Reads only libraryItem.media.metadata.asin: never the ISBN, never the ASIN RMAB sent.
 */
export function readMatchedAsin(outcome: ABSMatchOutcome | undefined | null): string | null {
  if (!outcome || outcome.status !== 'matched') return null;
  const raw = outcome.libraryItem?.media?.metadata?.asin;
  if (typeof raw !== 'string') return null;
  const asin = raw.trim();
  return ASIN_PATTERN.test(asin) ? asin : null;
}

/**
 * Store the matched ASIN on the plex_library row for this ABS item.
 * Never clears or blanks an ASIN; a different valid ASIN replaces the old one, which is what the
 * next full scan would write anyway (asin: item.asin || existing.asin).
 * Returns 'stored' | 'changed' | 'unchanged' | 'skipped'.
 */
export async function storeMatchedAsin(
  externalId: string,
  title: string,
  outcome: ABSMatchOutcome | undefined | null,
  logger: RMABLogger
): Promise<'stored' | 'changed' | 'unchanged' | 'skipped'> {
  if (!outcome || outcome.status === 'error') return 'skipped';
  if (outcome.status === 'no_match') {
    logger.info(`Audiobookshelf found no match for "${title}": ${outcome.warning}`);
    return 'skipped';
  }

  const asin = readMatchedAsin(outcome);
  if (!asin) {
    const raw = outcome.libraryItem?.media?.metadata?.asin;
    if (raw) logger.debug(`Ignoring non-ASIN value "${String(raw)}" from the Audiobookshelf match for "${title}"`);
    return 'skipped';
  }

  const row = await prisma.plexLibrary.findUnique({
    where: { plexGuid: externalId },
    select: { asin: true },
  });
  if (!row) {
    logger.debug(`No library record for "${title}" yet; its ASIN ${asin} will be stored by the next scan`);
    return 'skipped';
  }
  if (row.asin === asin) return 'unchanged';

  // updateMany: a row removed since the lookup is a no-op, not a throw
  await prisma.plexLibrary.updateMany({
    where: { plexGuid: externalId },
    data: { asin, updatedAt: new Date() },
  });

  if (row.asin) {
    logger.info(`ASIN changed by the Audiobookshelf match for "${title}": ${row.asin} → ${asin}`);
    return 'changed';
  }
  logger.info(`Stored ASIN ${asin} from the Audiobookshelf match for "${title}"`);
  return 'stored';
}

/**
 * Match every ABS item that was listed without an ASIN and read the ASIN back.
 * Per item: errors are logged and the loop continues.
 */
export async function matchItemsWithoutAsin(
  items: LibraryItem[],
  logger: RMABLogger,
  label = 'items'
): Promise<MatchMissingAsinsResult> {
  const itemsWithoutAsin = items.filter(item => !item.asin && item.externalId);
  const result: MatchMissingAsinsResult = {
    considered: itemsWithoutAsin.length,
    fileMatchCount: 0,
    fuzzyMatchCount: 0,
    asinsStored: 0,
    asinsChanged: 0,
  };
  if (itemsWithoutAsin.length === 0) return result;

  logger.info(`Found ${itemsWithoutAsin.length} ${label} without ASIN, attempting file hash matching...`);

  for (const item of itemsWithoutAsin) {
    try {
      // 1. Fetch full item details to get file list
      const absItem = await getABSItem(item.externalId);

      // 2. Extract audio filenames and generate hash
      const audioFilenames = absItem.media?.audioFiles?.map((f: any) => f.metadata?.filename).filter(Boolean) || [];
      const itemHash = generateFilesHash(audioFilenames);

      // 3. Query database for matching downloaded request
      let matchedAsin: string | undefined = undefined;

      if (itemHash) {
        const matchedAudiobook = await prisma.audiobook.findFirst({
          where: {
            filesHash: itemHash,
            status: 'completed',
          },
          select: {
            audibleAsin: true,
            title: true,
          },
        });

        if (matchedAudiobook?.audibleAsin) {
          matchedAsin = matchedAudiobook.audibleAsin;
          logger.info(
            `File hash match found for "${item.title}" → ASIN: ${matchedAsin} (from "${matchedAudiobook.title}")`
          );
          result.fileMatchCount++;
        }
      }

      // 4. Trigger metadata match (with ASIN if matched, undefined if not)
      const outcome = await triggerABSItemMatch(item.externalId, matchedAsin);

      if (matchedAsin) {
        logger.info(`Triggered metadata match with ASIN ${matchedAsin} for: "${item.title}"`);
      } else {
        logger.info(`No file match found, triggering fuzzy metadata match for: "${item.title}"`);
        result.fuzzyMatchCount++;
      }

      // 5. Read the ASIN back so request checks see it now, not at the next scan. Own try/catch: the
      //    match is already counted above, so a failed store must not count the item again.
      try {
        const stored = await storeMatchedAsin(item.externalId, item.title, outcome, logger);
        if (stored === 'stored' || stored === 'changed') result.asinsStored++;
        if (stored === 'changed') result.asinsChanged++;
      } catch (error) {
        logger.error(
          `Failed to store the matched ASIN for "${item.title}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    } catch (error) {
      logger.error(
        `Failed to process metadata match for "${item.title}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      result.fuzzyMatchCount++;
    }
  }

  logger.info(
    `Metadata match complete: ${result.fileMatchCount} file hash matches, ${result.fuzzyMatchCount} fuzzy matches, ` +
    `${result.asinsStored} ASINs stored from match responses`
  );

  return result;
}
