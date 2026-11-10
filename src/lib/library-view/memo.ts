/**
 * Component: Library view merged-entries memo (Load 2 + merge + query, reused while both versions hold)
 * Documentation: documentation/features/library-view.md
 *
 * The merged entries depend on the row snapshot and the qualifying requests only, never on the
 * viewer, so one copy serves every caller while the snapshot object and the requests version
 * (libraryRequestsVersion, read before the requests load) are unchanged. A request change moves
 * that version, so the very next call merges again. Filtered/sorted results are memoized per
 * query key on the same copy. Gating happens later, per viewer, in enrich.ts and serialize.ts.
 */

import { QUERY_MEMO_SIZE } from './constants';
import { loadDurations, loadLibraryRequests } from './loader';
import { applyDurations, mergeLibrary, requestOnlyAsins, type PreparedLibrary } from './merge';
import { computeQuery, queryKey, type LibraryFilters, type LibrarySortSpec, type QueryCore } from './query';
import type { LibraryEntry } from './types';

export interface MergedLibrary {
  prepared: PreparedLibrary;
  requestsVersion: string;
  entries: LibraryEntry[];
  /** Every request-only duration loaded (the duration sort needs them all). */
  allDurations: boolean;
  /** Request-only entries whose duration was already looked up. */
  durationLooked: Set<string>;
  queries: Map<string, QueryCore>;
}

let memo: MergedLibrary | null = null;
let pending: { prepared: PreparedLibrary; version: string; promise: Promise<MergedLibrary> } | null = null;

/** The merged entries for this snapshot and requests version; concurrent misses share one merge. */
export async function getMergedLibrary(prepared: PreparedLibrary, requestsVersion: string): Promise<MergedLibrary> {
  if (memo && memo.prepared === prepared && memo.requestsVersion === requestsVersion) return memo;
  if (pending && pending.prepared === prepared && pending.version === requestsVersion) return pending.promise;

  const promise: Promise<MergedLibrary> = loadLibraryRequests().then((requests) => {
    const merged: MergedLibrary = {
      prepared,
      requestsVersion,
      entries: mergeLibrary(prepared, requests),
      allDurations: false,
      durationLooked: new Set(),
      queries: new Map(),
    };
    // A merge started later (newer version or snapshot) owns the memo; an older one finishing late does not.
    if (pending?.promise === promise) {
      memo = merged;
      pending = null;
    }
    return merged;
  });
  pending = { prepared, version: requestsVersion, promise };
  promise.catch(() => {
    if (pending?.promise === promise) pending = null;
  });
  return promise;
}

/** Does this sort order by duration (author grouping orders by author and title instead)? */
function sortsByDuration(spec: LibrarySortSpec): boolean {
  return spec.sort === 'duration' && spec.group !== 'author';
}

/** The filtered, faceted, sorted result for one query key (LRU of QUERY_MEMO_SIZE per merged copy). */
export async function queryCoreFor(merged: MergedLibrary, filters: LibraryFilters, spec: LibrarySortSpec): Promise<QueryCore> {
  if (sortsByDuration(spec) && !merged.allDurations) {
    applyDurations(merged.entries, await loadDurations(requestOnlyAsins(merged.entries)));
    merged.allDurations = true;
  }
  const key = queryKey(filters, spec);
  const hit = merged.queries.get(key);
  if (hit) {
    merged.queries.delete(key);
    merged.queries.set(key, hit);
    return hit;
  }
  const core = computeQuery(merged.entries, filters, spec);
  merged.queries.set(key, core);
  if (merged.queries.size > QUERY_MEMO_SIZE) merged.queries.delete(merged.queries.keys().next().value!);
  return core;
}

/** Durations for the request-only books on this page that were not looked up yet. */
export async function fillPageDurations(merged: MergedLibrary, page: LibraryEntry[]): Promise<void> {
  if (merged.allDurations) return;
  const todo = page.filter((e) => !e.inLibrary && e.durationMinutes == null && !merged.durationLooked.has(e.id));
  const asins = requestOnlyAsins(todo);
  if (asins.length > 0) applyDurations(todo, await loadDurations(asins));
  for (const entry of todo) merged.durationLooked.add(entry.id);
}

/** Drop the memo (tests). */
export function resetLibraryMemo(): void {
  memo = null;
  pending = null;
}
