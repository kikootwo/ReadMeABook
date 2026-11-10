/**
 * Component: Library view merge (pure): library rows + audiobook requests → one entry per book
 * Documentation: documentation/features/library-view.md
 */

import { RMABLogger } from '@/lib/utils/logger';
import { SORT_KEY_LENGTH, STATUS_GROUP_OF } from './constants';
import { buildAsinIndex, matchByAsin, type AsinIndex } from './asin-rule';
import type { LibraryEntry, LibraryRowRecord, RequestRecord, StatusGroup } from './types';

const logger = RMABLogger.create('LibraryView.Merge');

/** Case, diacritics and whitespace folded (search tokens, sort and group keys). */
export function fold(value: string | null | undefined): string {
  if (!value) return '';
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A folded sort/group key, truncated so cursors stay small. */
export function sortKey(value: string | null | undefined): string {
  return fold(value).slice(0, SORT_KEY_LENGTH);
}

/** A library value, or null when empty (ABS's 'Unknown Author' counts as empty, as on request cards). */
function shown(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v && v !== 'Unknown Author' ? v : null;
}

/** Only audiobook requests that are not cancelled or deleted count (re-checked after the loader). */
export function isQualifying(request: RequestRecord): boolean {
  return request.type === 'audiobook' && request.status !== 'cancelled' && !request.deletedAt;
}

export function statusGroupOf(status: string): StatusGroup {
  return STATUS_GROUP_OF[status] ?? 'on_the_way';
}

function haystack(values: (string | null | undefined)[]): string {
  return values.map(fold).filter(Boolean).join('\n');
}

/** Newest first; ties by id so the primary request is deterministic. */
function newestFirst(a: RequestRecord, b: RequestRecord): number {
  const diff = b.createdAt.getTime() - a.createdAt.getTime();
  return diff !== 0 ? diff : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

interface Claim {
  primary: RequestRecord;
  viaLink: boolean;
}

/** Stored link beats the ASIN rule, then the latest primary request, then the audiobook id. */
function beats(a: Claim, b: Claim): boolean {
  if (a.viaLink !== b.viaLink) return a.viaLink;
  const diff = a.primary.createdAt.getTime() - b.primary.createdAt.getTime();
  if (diff !== 0) return diff > 0;
  return a.primary.audiobookId < b.primary.audiobookId;
}

function libraryEntry(row: LibraryRowRecord, primary: RequestRecord | null): LibraryEntry {
  const book = primary?.audiobook ?? null;
  const title = shown(row.title) ?? book?.title ?? row.title;
  const author = shown(row.author) ?? book?.author ?? row.author;
  const narrator = shown(row.narrator) ?? book?.narrator ?? null;
  return {
    id: primary ? `req_${primary.audiobookId}` : `lib_${row.id}`,
    title,
    author,
    narrator,
    series: book?.series ?? null,
    seriesPart: book?.seriesPart ?? null,
    year: row.year ?? book?.year ?? null,
    durationMinutes: row.duration != null ? Math.round(Number(row.duration) / 60000) : null,
    inLibrary: true,
    source: primary ? 'rmab' : 'scan',
    addedAtMs: (row.addedAt ?? row.createdAt).getTime(),
    status: 'available',
    statusGroup: 'available',
    progress: null,
    releaseDate: primary?.releaseDate ?? null,
    row,
    primary,
    haystack: haystack([title, author, narrator, book?.series, book?.title, book?.author, book?.narrator]),
    authorKey: sortKey(author),
    titleKey: sortKey(title),
  };
}

function requestOnlyEntry(primary: RequestRecord): LibraryEntry {
  const book = primary.audiobook;
  const statusGroup = statusGroupOf(primary.status);
  return {
    id: `req_${primary.audiobookId}`,
    title: book.title,
    author: book.author,
    narrator: book.narrator,
    series: book.series,
    seriesPart: book.seriesPart,
    year: book.year,
    durationMinutes: null,
    inLibrary: false,
    source: 'rmab',
    addedAtMs: primary.createdAt.getTime(),
    status: primary.status,
    statusGroup,
    progress: statusGroup === 'on_the_way' ? primary.progress : null,
    releaseDate: primary.releaseDate,
    row: null,
    primary,
    haystack: haystack([book.title, book.author, book.narrator, book.series]),
    authorKey: sortKey(book.author),
    titleKey: sortKey(book.title),
  };
}

/**
 * The request-independent half of the merge for one set of library rows: link and ASIN indexes and
 * each row's scan-only entry. Immutable once built, so the snapshot cache (snapshot.ts) shares it
 * across calls; entries for rows a request claims are built per call.
 */
export interface PreparedLibrary {
  rows: readonly LibraryRowRecord[];
  byGuid: ReadonlyMap<string, LibraryRowRecord>;
  index: AsinIndex<LibraryRowRecord>;
  scanEntries: readonly LibraryEntry[];
}

export function prepareLibrary(rows: readonly LibraryRowRecord[]): PreparedLibrary {
  return {
    rows,
    byGuid: new Map(rows.map((row) => [row.plexGuid, row])),
    index: buildAsinIndex(rows),
    // Shared across calls by the snapshot cache: frozen so a downstream write throws, not leaks.
    scanEntries: rows.map((row) => Object.freeze(libraryEntry(row, null))),
  };
}

/**
 * Merge the active library's rows with the qualifying audiobook requests. Each library row absorbs
 * at most one book; books folded into another book's row are not listed (debug log).
 */
export function mergeLibrary(
  library: PreparedLibrary | readonly LibraryRowRecord[],
  requests: readonly RequestRecord[]
): LibraryEntry[] {
  const { rows, byGuid, index, scanEntries } = 'scanEntries' in library ? library : prepareLibrary(library);
  const books = new Map<string, RequestRecord[]>();
  for (const request of requests) {
    if (!isQualifying(request)) continue;
    const list = books.get(request.audiobookId);
    if (list) list.push(request);
    else books.set(request.audiobookId, [request]);
  }

  const claims = new Map<string, Claim>();
  const requestOnly: RequestRecord[] = [];

  for (const list of books.values()) {
    list.sort(newestFirst);
    const primary = list[0];
    const book = primary.audiobook;
    const linked = (book.absItemId && byGuid.get(book.absItemId)) || (book.plexGuid && byGuid.get(book.plexGuid)) || null;
    const row = linked || matchByAsin(index, book.audibleAsin);
    if (!row) {
      requestOnly.push(primary);
      continue;
    }
    const claim: Claim = { primary, viaLink: !!linked };
    const current = claims.get(row.id);
    if (!current) {
      claims.set(row.id, claim);
      continue;
    }
    const [winner, loser] = beats(claim, current) ? [claim, current] : [current, claim];
    claims.set(row.id, winner);
    logger.debug('Book folded into another book on the same library row', {
      libraryRowId: row.id,
      kept: winner.primary.audiobookId,
      folded: loser.primary.audiobookId,
    });
  }

  const entries: LibraryEntry[] = rows.map((row, i) => {
    const claim = claims.get(row.id);
    return claim ? libraryEntry(row, claim.primary) : scanEntries[i];
  });
  for (const primary of requestOnly) entries.push(requestOnlyEntry(primary));
  return entries;
}

/** ASINs of request-only books (their duration comes from audible_cache). */
export function requestOnlyAsins(entries: readonly LibraryEntry[]): string[] {
  const asins = new Set<string>();
  for (const entry of entries) {
    const asin = entry.inLibrary ? null : entry.primary?.audiobook.audibleAsin?.trim();
    if (asin) asins.add(asin);
  }
  return [...asins];
}

/** Fill request-only durations from audible_cache minutes, keyed by uppercase ASIN. */
export function applyDurations(entries: LibraryEntry[], minutesByAsin: ReadonlyMap<string, number>): void {
  for (const entry of entries) {
    if (entry.inLibrary || entry.durationMinutes != null) continue;
    const asin = entry.primary?.audiobook.audibleAsin?.trim().toUpperCase();
    const minutes = asin ? minutesByAsin.get(asin) : undefined;
    if (minutes != null) entry.durationMinutes = minutes;
  }
}
