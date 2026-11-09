/**
 * Component: ASIN shape helpers (library ASINs, #287, #325a)
 * Documentation: documentation/fixes/file-hash-matching.md
 *
 * Dependency-free on purpose: the scan processors load the Audiobookshelf client lazily, so the
 * modules they import eagerly (follow-library-asin, library-cover) take the pattern from here.
 */

/** Audible ASINs are 10 alphanumerics (B0..., or ISBN-10 style digits for some titles). */
export const ASIN_PATTERN = /^[A-Z0-9]{10}$/i;

/** The value trimmed when it is ASIN-shaped, else null (empty, ISBN-13, hyphenated ISBN). */
export function asinShaped(value: string | null | undefined): string | null {
  const asin = value?.trim();
  return asin && ASIN_PATTERN.test(asin) ? asin : null;
}

/** Both set and equal, ignoring case. */
export function sameAsin(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toUpperCase() === b.toUpperCase();
}
