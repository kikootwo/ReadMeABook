/**
 * Component: Indexer Search Failure Tracking
 * Documentation: documentation/phase3/prowlarr.md
 *
 * Counts the indexer searches a search run sent and the ones that failed, so a failed
 * search is never reported as "nothing found" (#522).
 */

export interface SearchFailure {
  /** The query text, or "(whole group)" when a group's search threw as a whole */
  query: string;
  /** The error message only: never a URL, an API key or a response body */
  message: string;
}

/** Filled in by ProwlarrService.searchWithVariations (out-param) and summed across indexer groups */
export interface SearchStats {
  queriesSent: number;
  queriesFailed: number;
  failures: SearchFailure[];
}

/** Interactive search responses carry this when at least one search failed */
export interface SearchFailureSummary {
  failed: number;
  total: number;
  /** Distinct error messages, at most MAX_ERRORS */
  errors: string[];
}

interface WarnLogger {
  warn(message: string): void;
}

const MESSAGE_MAX = 200;
const MAX_ERRORS = 3;

export function newSearchStats(): SearchStats {
  return { queriesSent: 0, queriesFailed: 0, failures: [] };
}

/** An error's message for logs and responses: no "Failed to search Prowlarr" prefix, URLs masked, capped */
export function searchErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Unknown error';
  const message = raw
    .replace(/^Failed to search Prowlarr: /, '')
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    .trim();
  return (message || 'Unknown error').slice(0, MESSAGE_MAX);
}

/** Counts one failed search (a query, or a whole group whose search threw) */
export function recordFailure(stats: SearchStats, query: string, error: unknown): void {
  stats.queriesSent++;
  stats.queriesFailed++;
  stats.failures.push({ query, message: searchErrorMessage(error) });
}

/**
 * Counts a whole search run that threw as one failure, but only when none of its groups was counted
 * yet: a run that throws after searching (in ranking, say) already holds its group counts.
 */
export function recordRunFailure(stats: SearchStats, error: unknown): void {
  if (stats.queriesSent === 0) recordFailure(stats, '(indexer search)', error);
}

/** Adds one indexer group's searches to the run's totals, with one warn line per failed search */
export function addGroupSearch(totals: SearchStats, group: SearchStats, groupDescription: string, logger: WarnLogger): void {
  for (const failure of group.failures) {
    logger.warn(`Indexer search failed: "${failure.query}" (${groupDescription}): ${failure.message}`);
  }
  totals.queriesSent += group.queriesSent;
  totals.queriesFailed += group.queriesFailed;
  totals.failures.push(...group.failures);
}

/** "2 of 5 indexer searches failed" as a warn line; nothing when none failed */
export function logSearchSummary(logger: WarnLogger, stats: SearchStats): void {
  if (stats.queriesFailed > 0) {
    logger.warn(`${stats.queriesFailed} of ${stats.queriesSent} indexer searches failed`);
  }
}

/**
 * The request's "nothing usable found" message, e.g. "No torrents/nzbs found (2 of 5 indexer searches
 * failed; see System Logs). Will retry automatically." Unchanged when no search failed. When every
 * search failed it says so instead, after `allFailedPrefix` (what other sources found, if any).
 */
export function noResultsMessage(nothingFound: string, stats: SearchStats, allFailedPrefix = ''): string {
  const { queriesSent: sent, queriesFailed: failed } = stats;
  if (failed === 0) return `${nothingFound}. Will retry automatically.`;
  if (failed >= sent) {
    return `${allFailedPrefix}${sent === 1 ? 'The indexer search' : `All ${sent} indexer searches`} failed (see System Logs). Will retry automatically.`;
  }
  return `${nothingFound} (${failed} of ${sent} indexer searches failed; see System Logs). Will retry automatically.`;
}

/** The failure count for an interactive search response; undefined when no search failed */
export function searchFailureSummary(stats: SearchStats): SearchFailureSummary | undefined {
  if (stats.queriesFailed === 0) return undefined;
  const errors = [...new Set(stats.failures.map((f) => f.message))].slice(0, MAX_ERRORS);
  return { failed: stats.queriesFailed, total: stats.queriesSent, errors };
}
