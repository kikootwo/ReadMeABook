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
const DIGIT_ASIN_RE = /(?<![A-Z0-9])(?<!\d[-.:,_/])(\d{9}[\dX])(?![A-Z0-9])(?![-.:,_/]\d)/gi;

// A trailing series position ("Dune, Book 1"), which hand-named folders often leave out
const SERIES_POSITION_RE = /(?:[,:]\s*|\s+)(?:book|volume|vol\.?|part)\s+\d+\s*$/i;

/** The last all-digit ASIN candidate in a folder name (the template writes `{asin}` last), upper-cased, or null. */
export function extractDigitAsinCandidate(folderName: string): string | null {
  const runs = [...folderName.matchAll(DIGIT_ASIN_RE)];
  return runs.length > 0 ? runs[runs.length - 1][1].toUpperCase() : null;
}

/**
 * True when the folder name holds enough of the catalog title's words. The title is
 * compared without its subtitle, edition marker or trailing series position, which
 * folder names often leave out.
 */
export function catalogTitleFitsFolder(catalogTitle: string, folderName: string, langConfig: LanguageConfig): boolean {
  const title = normalizeTitle(catalogTitle.replace(SERIES_POSITION_RE, '')) || catalogTitle;
  return matchShare(folderName, title, langConfig) >= CANDIDATE_TITLE_SHARE;
}
