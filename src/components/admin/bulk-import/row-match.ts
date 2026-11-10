/**
 * Component: Bulk Import review rows - effective match, Change match and Undo (pure helpers)
 * Documentation: documentation/features/bulk-import.md
 *
 * A changed row keeps the scan's match for Undo and holds the picked book in `chosen`. Everything
 * the review screen counts, shows or sends reads the effective match.
 */

import { sameAsin } from '@/lib/utils/asin';
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

/**
 * A candidate picked for the row; either way the row is included. The scan's own book counts as no
 * change, unless the scan flagged it (In Library / Requested) and the dialog found it free since:
 * then it is kept as a pick, so the row loses the stale flag and can still be skipped or undone.
 */
export function applyChosen(book: ScannedBook, candidate: MatchCandidate): ScannedBook {
  const match: AudibleMatch = {
    asin: candidate.asin, title: candidate.title, author: candidate.author, narrator: candidate.narrator,
    coverArtUrl: candidate.coverArtUrl, durationMinutes: candidate.durationMinutes,
  };
  const noChange = sameAsin(book.match?.asin, match.asin) && !book.inLibrary && !book.hasActiveRequest;
  return { ...book, chosen: noChange ? undefined : { match }, skipped: false };
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

/**
 * Included rows split for Start Import: `send` names a book no other included row names; `held`
 * shares one (never sent, counted or imported; the server refuses repeats as a backstop).
 */
export function splitForImport(books: ScannedBook[]): { send: ScannedBook[]; held: ScannedBook[] } {
  const shared = sharedAsins(books);
  const included = books.filter(isImportable);
  return {
    send: included.filter((b) => !isSharedRow(b, shared)),
    held: included.filter((b) => isSharedRow(b, shared)),
  };
}
