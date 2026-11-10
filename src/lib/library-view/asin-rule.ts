/**
 * Component: Library view ASIN rule (the one rule for "this request is that library book")
 * Documentation: documentation/features/library-view.md
 *
 * Same decision as findPlexMatch (src/lib/utils/audiobook-matcher.ts, untouched): the row's `asin`
 * field equals the book's ASIN, else the row's plex_guid contains it. One documented divergence: the
 * Library compares case-insensitively everywhere, while findPlexMatch's DB prefilter is
 * case-sensitive, so a case-only mismatch merges here but never flips a request to available
 * (rare; ASINs are uppercase in practice). The guid lookup takes only ASIN-shaped values (10
 * alphanumerics), found inside an alphanumeric run of the guid, which is where "contains" can hit.
 * Indexed once per load so a 30k-row library merges in linear time.
 */

import { ASIN_PATTERN } from '@/lib/utils/asin';

export interface AsinIndexedRow {
  plexGuid: string;
  asin: string | null;
}

export interface AsinIndex<T extends AsinIndexedRow> {
  byField: Map<string, T>;
  byGuid: Map<string, T>;
}

const ASIN_LENGTH = 10;

/** Every 10-character window of each alphanumeric run (length ≥ 10) in `guid`, uppercased. */
export function guidAsinWindows(guid: string): string[] {
  const windows: string[] = [];
  for (const run of guid.toUpperCase().match(/[A-Z0-9]{10,}/g) ?? []) {
    for (let i = 0; i + ASIN_LENGTH <= run.length; i++) windows.push(run.slice(i, i + ASIN_LENGTH));
  }
  return windows;
}

/** Index rows by asin field and by guid windows. The first row (load order) wins each key. */
export function buildAsinIndex<T extends AsinIndexedRow>(rows: readonly T[]): AsinIndex<T> {
  const byField = new Map<string, T>();
  const byGuid = new Map<string, T>();
  for (const row of rows) {
    const field = row.asin?.toUpperCase();
    if (field && !byField.has(field)) byField.set(field, row);
    for (const w of new Set(guidAsinWindows(row.plexGuid))) {
      if (!byGuid.has(w)) byGuid.set(w, row);
    }
  }
  return { byField, byGuid };
}

/** The library row the ASIN rule picks for `asin`, or null. Field match beats guid match. */
export function matchByAsin<T extends AsinIndexedRow>(index: AsinIndex<T>, asin: string | null | undefined): T | null {
  // Like findPlexMatch: an empty/blank ASIN never matches; the value itself is not trimmed
  if (!asin || asin.trim() === '') return null;
  const value = asin.toUpperCase();
  const byField = index.byField.get(value);
  if (byField) return byField;
  const shaped = ASIN_PATTERN.test(value) ? value : null;
  return shaped ? index.byGuid.get(shaped) ?? null : null;
}
