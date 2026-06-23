/**
 * Component: Minimum Quality Score helpers
 * Documentation: documentation/settings-pages.md
 *
 * Single source of truth for the automatic-search minimum ranking threshold.
 * The settings GET route, the indexer-options route, and the search processors
 * all read the same `indexer.min_quality_score(_ebook)` config keys and MUST
 * interpret them identically — share this helper rather than re-deriving it.
 */

/** Default threshold used when the admin has not configured one. */
export const DEFAULT_MIN_QUALITY_SCORE = 50;

/**
 * Parse a stored minimum-score threshold into a clamped integer 0-100.
 * Missing/invalid values fall back to DEFAULT_MIN_QUALITY_SCORE.
 */
export function parseMinQualityScore(value: string | null | undefined): number {
  const parsed = parseInt(value ?? '', 10);
  if (Number.isNaN(parsed)) return DEFAULT_MIN_QUALITY_SCORE;
  return Math.min(100, Math.max(0, parsed));
}
