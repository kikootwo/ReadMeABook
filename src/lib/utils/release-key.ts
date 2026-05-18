/**
 * Component: Release Key Normalizer
 * Documentation: documentation/backend/database.md
 *
 * Pure helper used by the blocklist service and search filters to compare
 * release names case-insensitively without per-call .toLowerCase() drift.
 */

/**
 * Normalize a release name into a stable lookup key.
 * Rule: trim outer whitespace, then lowercase.
 *
 * Used as the persisted `release_key` column AND the runtime comparison value
 * for filtering search results — both sides MUST go through this function.
 */
export function normalizeReleaseKey(name: string): string {
  return name.trim().toLowerCase();
}
