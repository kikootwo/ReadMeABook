/**
 * Component: Blocked Results Filter
 * Documentation: documentation/backend/database.md
 *
 * Pre-rank filter applied by every automatic search path (audiobook, ebook, RSS)
 * to remove releases already on a request's blocklist. Matches case-insensitive
 * on release name and exact on hash (when both sides have one).
 *
 * Interactive admin search does NOT call this — admins see all results and the
 * UI surfaces a blocked badge instead.
 */

import { getBlocklistForRequest } from '@/lib/services/blocklist.service';
import { normalizeReleaseKey } from '@/lib/utils/release-key';

export interface FilterableResult {
  title: string;
  infoHash?: string;
}

export interface FilterBlockedResultsOutput<T> {
  kept: T[];
  blockedCount: number;
}

/**
 * Filter out search results that match a row on the request's blocklist.
 *
 * Match rules:
 * - Name: case-insensitive exact via [[normalize-release-key]].
 * - Hash: exact, only when both the result and a blocklist row have one.
 *
 * Returns the original array unchanged when there are no results or no
 * blocklist rows — both are common hot-path cases, so we short-circuit.
 */
export async function filterBlockedResults<T extends FilterableResult>(
  requestId: string,
  results: T[]
): Promise<FilterBlockedResultsOutput<T>> {
  if (results.length === 0) {
    return { kept: results, blockedCount: 0 };
  }

  const blocklist = await getBlocklistForRequest(requestId);
  if (blocklist.length === 0) {
    return { kept: results, blockedCount: 0 };
  }

  const keys = new Set(blocklist.map(b => b.releaseKey));
  const hashes = new Set(
    blocklist.filter(b => b.releaseHash).map(b => b.releaseHash as string)
  );

  const kept = results.filter(r => {
    if (keys.has(normalizeReleaseKey(r.title))) return false;
    if (r.infoHash && hashes.has(r.infoHash)) return false;
    return true;
  });

  return { kept, blockedCount: results.length - kept.length };
}
