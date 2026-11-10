/**
 * Component: Bulk Import shared constants (refusal reasons, match search limits)
 * Documentation: documentation/features/bulk-import.md
 *
 * Client-safe: the review screen and the execute/match routes read the same words and limits.
 */

/** The reason an import row was refused (execute `results[].error`), shown on the finished screen. */
export const BULK_IMPORT_REFUSAL = {
  invalidAsin: 'Invalid ASIN',
  duplicate: 'Same book as another row',
  notFound: 'Audiobook not found',
  lookupFailed: 'Failed to fetch audiobook details',
  inLibrary: 'Already in your library',
  requested: 'Already requested',
} as const;

/** Longest search text GET /api/admin/bulk-import/match accepts. */
export const MATCH_QUERY_MAX_LENGTH = 200;

/** Results the match search returns (first page of Audible's search). */
export const MATCH_RESULT_LIMIT = 20;
