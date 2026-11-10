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

/**
 * An ASIN typed into a search field (Bulk Import "Change match"): `B0` + 8 alphanumerics, or nine
 * digits + a digit or X (ISBN-10 style). Stricter than ASIN_PATTERN so a 10-letter title
 * ("Foundation") stays a text search. The folder-name rules differ on purpose: the scanner's
 * bounded `B[A-Z0-9]{9}` and the all-digit candidate (bulk-import-asin.ts) read names, and
 * changing what they read would change which folders match.
 */
export const TYPED_ASIN_PATTERN = /^(B0[A-Z0-9]{8}|\d{9}[\dX])$/i;

/** The value trimmed and upper-cased when it reads as a typed ASIN, else null. */
export function typedAsin(value: string | null | undefined): string | null {
  const asin = value?.trim();
  return asin && TYPED_ASIN_PATTERN.test(asin) ? asin.toUpperCase() : null;
}

/** Both set and equal, ignoring case. */
export function sameAsin(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toUpperCase() === b.toUpperCase();
}
