/**
 * Component: Plex Audible ID check (#298)
 * Documentation: documentation/integrations/plex.md
 *
 * Requests match Plex items only by the Audible ID (ASIN) in the item's guid, which the
 * Audnexus agent adds. Items from another agent (Personal Media, Plex's own album agent)
 * never match; a full scan counts them and logs one warning so the cause is visible.
 */

import type { LibraryItem } from './ILibraryService';
import type { RMABLogger } from '../../utils/logger';

// A 10-character ASIN right after the agent scheme, e.g.
// com.plexapp.agents.audnexus://B08G9PRS1K_us?lang=en or com.plexapp.agents.audible://B00ABC1234?lang=en
const ASIN_IN_GUID = /:\/\/[A-Z0-9]{10}(?=[_?/#]|$)/i;

/** True when the Plex item carries an Audible ID that request matching can use. */
export function hasAudibleId(item: Pick<LibraryItem, 'asin' | 'externalId'>): boolean {
  return Boolean(item.asin) || ASIN_IN_GUID.test(item.externalId || '');
}

/** Logs one warn line when any scanned Plex item has no Audible ID. Returns that count. */
export function warnPlexItemsWithoutAudibleId(
  items: Pick<LibraryItem, 'asin' | 'externalId'>[],
  logger: RMABLogger
): number {
  const missing = items.filter(item => !hasAudibleId(item)).length;
  if (missing > 0) {
    logger.warn(
      `${missing} of ${items.length} Plex items have no Audible ID in their metadata, so requests can't be marked available for them. Plex libraries need the Audnexus agent.`
    );
  }
  return missing;
}
