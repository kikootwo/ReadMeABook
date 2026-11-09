/**
 * Component: Release Date Gate (setting read)
 * Documentation: documentation/backend/database.md
 *
 * One place that reads `indexer.skip_unreleased` and applies `shouldSkipAutoSearch`
 * for request creation and admin approval, so both decide the same way.
 */

import { getConfigService } from '@/lib/services/config.service';
import { RMABLogger } from '@/lib/utils/logger';
import { shouldSkipAutoSearch } from '@/lib/utils/release-date';

const logger = RMABLogger.create('ReleaseGate');

/**
 * True when an automatic search should wait for the book's release day:
 * the setting is on (default when unset) and the release date is after today (UTC).
 * Undated books and a failed setting read never wait.
 */
export async function shouldWaitForRelease(
  releaseDate: Date | string | null | undefined
): Promise<boolean> {
  try {
    const settingOn = (await getConfigService().get('indexer.skip_unreleased')) !== 'false';
    return shouldSkipAutoSearch({ releaseDate }, settingOn).skip;
  } catch (error) {
    logger.warn(`Failed to evaluate release-date gate: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}
