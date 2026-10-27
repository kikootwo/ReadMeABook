/**
 * Component: Bulk Import All-Digit ASIN Candidates
 * Documentation: documentation/features/bulk-import.md
 *
 * Older Audible books use their ISBN-10 as the ASIN (all digits, the last may be X).
 * Ten digits in a folder name can be anything, so such an ASIN is only a candidate:
 * the scan treats it as a direct match only when the catalog title fits the folder name.
 */

import type { LanguageConfig } from '../constants/language-config';
import { matchShare } from '../integrations/audible-series-rank';
import { normalizeTitle } from './deduplicate-audiobooks';

/** Share of the catalog title's words the folder name must hold (the ranking's word coverage bar). */
export const CANDIDATE_TITLE_SHARE = 0.8;

// Nine digits then a digit or X, not touching a letter or digit, and not joined to
// another number by a separator (ISBN-13 parts, date and time stamps).
const DIGIT_ASIN_RE = /(?<![A-Z0-9])(?<!\d[-.:,_/])(\d{9}[\dX])(?![A-Z0-9])(?![-.:,_/]\d)/i;

/** The first all-digit ASIN candidate in a folder name, upper-cased, or null. */
export function extractDigitAsinCandidate(folderName: string): string | null {
  const match = folderName.match(DIGIT_ASIN_RE);
  return match ? match[1].toUpperCase() : null;
}

/**
 * True when the folder name holds enough of the catalog title's words. The title is
 * compared without its subtitle or edition marker, which folder names often leave out.
 */
export function catalogTitleFitsFolder(catalogTitle: string, folderName: string, langConfig: LanguageConfig): boolean {
  const title = normalizeTitle(catalogTitle) || catalogTitle;
  return matchShare(folderName, title, langConfig) >= CANDIDATE_TITLE_SHARE;
}
