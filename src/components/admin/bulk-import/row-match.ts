/**
 * Component: Bulk Import review rows - effective match, Change match and Undo (pure helpers)
 * Documentation: documentation/features/bulk-import.md
 *
 * A changed row keeps the scan's match for Undo and holds the picked book in `chosen`. Everything
 * the review screen counts, shows or sends reads the effective match.
 */

import type { AudibleMatch, MatchCandidate, ScannedBook } from './types';

/** The picked book, else the scan's match. */
export function effectiveMatch(book: ScannedBook): AudibleMatch | null {
  return book.chosen?.match ?? book.match;
}

/** The row's flags: a picked book was free when it was picked, so a changed row has none. */
export function effectiveFlags(book: ScannedBook): { inLibrary: boolean; hasActiveRequest: boolean } {
  return book.chosen
    ? { inLibrary: false, hasActiveRequest: false }
    : { inLibrary: book.inLibrary, hasActiveRequest: book.hasActiveRequest };
}

/** The scan's default: skip books in the library, already requested, or with no match. */
export function defaultSkipped(book: Pick<ScannedBook, 'inLibrary' | 'hasActiveRequest' | 'match'>): boolean {
  return book.inLibrary || book.hasActiveRequest || book.match === null;
}

/** Change match / Find match: not on In Library rows, not on rows in the media folder. */
export function canChangeMatch(book: ScannedBook): boolean {
  return !book.inLibrary && !book.inMediaFolder;
}

/** "Change match" when the row has a book, else "Find match". */
export function matchLabel(book: ScannedBook): 'Change match' | 'Find match' {
  return effectiveMatch(book) ? 'Change match' : 'Find match';
}

/** A candidate picked for the row. The scan's own book counts as no change. Either way the row is included. */
export function applyChosen(book: ScannedBook, candidate: MatchCandidate): ScannedBook {
  const match: AudibleMatch = {
    asin: candidate.asin, title: candidate.title, author: candidate.author, narrator: candidate.narrator,
    coverArtUrl: candidate.coverArtUrl, durationMinutes: candidate.durationMinutes,
  };
  const sameAsScan = !!book.match && book.match.asin.toUpperCase() === match.asin.toUpperCase();
  return { ...book, chosen: sameAsScan ? undefined : { match }, skipped: false };
}

/** Back to the scan's match and its default skip. */
export function undoChosen(book: ScannedBook): ScannedBook {
  return { ...book, chosen: undefined, skipped: defaultSkipped(book) };
}

/** Included in the import: not skipped and has a book. */
export function isImportable(book: ScannedBook): boolean {
  return !book.skipped && effectiveMatch(book) !== null;
}

/** The execute row for an importable book. */
export function toImportItem(book: ScannedBook): { folderPath: string; asin: string; audioFiles: string[] } {
  return { folderPath: book.folderPath, asin: effectiveMatch(book)!.asin, audioFiles: book.audioFiles };
}

/** Upper-cased ASINs that two or more included rows share (the import refuses all of them). */
export function sharedAsins(books: ScannedBook[]): Set<string> {
  const counts = new Map<string, number>();
  for (const book of books) {
    if (!isImportable(book)) continue;
    const asin = effectiveMatch(book)!.asin.toUpperCase();
    counts.set(asin, (counts.get(asin) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([asin]) => asin));
}

/** True when this included row shares its ASIN with another included row. */
export function isSharedRow(book: ScannedBook, shared: Set<string>): boolean {
  return isImportable(book) && shared.has(effectiveMatch(book)!.asin.toUpperCase());
}

/** "8h 5m" / "45m"; empty when unknown. */
export function formatDuration(minutes?: number): string {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
