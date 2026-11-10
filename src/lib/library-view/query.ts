/**
 * Component: Library view query (pure): filters, disjunctive facets, stats, sort, keyset page, groups
 * Documentation: documentation/features/library-view.md
 */

import { STATUS_GROUPS, STATUS_GROUP_RANK } from './constants';
import { fold } from './fold';
import type { SortTuple, SortValue } from './cursor';
import type {
  LibraryEntry,
  LibraryGroupMode,
  LibraryResponse,
  LibrarySortKey,
  LibrarySortOrder,
  LibrarySource,
  RequestedByFacet,
  StatusGroup,
} from './types';

export interface LibraryFilters {
  /** Folded search tokens; every one must match. */
  tokens: string[];
  status: ReadonlySet<StatusGroup> | null;
  source: ReadonlySet<LibrarySource> | null;
  /** Validated uuids as given (ids outside the requester universe are dropped here). */
  requestedBy: readonly string[] | null;
  hideAvailable: boolean;
}

export interface LibrarySortSpec {
  sort: LibrarySortKey;
  order: LibrarySortOrder;
  group: LibraryGroupMode;
}

/** The viewer-independent part of a query: matched entries in sort order, stats and facets. */
export interface QueryCore {
  sorted: LibraryEntry[];
  stats: LibraryResponse['stats'];
  facets: LibraryResponse['facets'];
  /** Label and match count per author key (group=author only; filled on first use). */
  groupsByAuthor?: Map<string, { label: string; count: number }>;
}

export interface QueryResult {
  page: LibraryEntry[];
  /** Sort tuple of the last entry when more entries follow, else null. */
  nextTuple: SortTuple | null;
  matched: number;
  stats: LibraryResponse['stats'];
  facets: LibraryResponse['facets'];
  /** group=author: one group per author on this page, each counted over every match; else null. */
  groups: LibraryResponse['groups'];
}

/** A memo key for one filter set and sort (order-insensitive where the filter is a set). */
export function queryKey(filters: LibraryFilters, spec: LibrarySortSpec): string {
  const set = (values: Iterable<string> | null) => (values ? [...values].sort() : null);
  return JSON.stringify([filters.tokens, set(filters.status), set(filters.source), set(filters.requestedBy), filters.hideAvailable, spec.sort, spec.order, spec.group]);
}

/** The entry's sort tuple (the last value is always its id). */
export function sortTupleOf(entry: LibraryEntry, spec: LibrarySortSpec): SortTuple {
  if (spec.group === 'author') return [entry.authorKey, entry.titleKey, entry.id];
  switch (spec.sort) {
    case 'title':
      return [entry.titleKey, entry.id];
    case 'author':
      return [entry.authorKey, entry.id];
    case 'year':
      return [entry.year, entry.id];
    case 'duration':
      return [entry.durationMinutes, entry.id];
    case 'status':
      return [STATUS_GROUP_RANK[entry.statusGroup], entry.id];
    default:
      return [entry.addedAtMs, entry.id];
  }
}

function compareValues(a: SortValue, b: SortValue, dir: number): number {
  if (a === b) return 0;
  if (a === null) return 1; // nulls last in either direction
  if (b === null) return -1;
  return (a < b ? -1 : 1) * dir;
}

/** Tuple order: each value in `dir` with nulls last, then the id ascending. */
export function compareTuples(a: SortTuple, b: SortTuple, spec: LibrarySortSpec): number {
  const dir = spec.group === 'author' || spec.order === 'asc' ? 1 : -1;
  const last = a.length - 1;
  for (let i = 0; i < last; i++) {
    const c = compareValues(a[i], b[i], dir);
    if (c !== 0) return c;
  }
  return compareValues(a[last], b[last], 1);
}

function emptyStatusCounts(): Record<StatusGroup, number> {
  return Object.fromEntries(STATUS_GROUPS.map((g) => [g, 0])) as Record<StatusGroup, number>;
}

/** Primary requesters of every entry (deleted accounts included). */
function requesterUniverse(entries: readonly LibraryEntry[]): Map<string, { username: string; deleted: boolean }> {
  const universe = new Map<string, { username: string; deleted: boolean }>();
  for (const entry of entries) {
    const user = entry.primary?.user;
    if (user && !universe.has(user.id)) universe.set(user.id, { username: user.plexUsername, deleted: !!user.deletedAt });
  }
  return universe;
}

/** Filter, facet and sort every entry (no viewer input; memoized per query key by memo.ts). */
export function computeQuery(entries: readonly LibraryEntry[], filters: LibraryFilters, spec: LibrarySortSpec): QueryCore {
  const universe = requesterUniverse(entries);
  const requesters = filters.requestedBy ? new Set(filters.requestedBy.filter((id) => universe.has(id))) : null;

  const inStatus = (e: LibraryEntry) => !filters.status || filters.status.has(e.statusGroup);
  const inSource = (e: LibraryEntry) => !filters.source || filters.source.has(e.source);
  const inRequesters = (e: LibraryEntry) => !requesters || (!!e.primary && requesters.has(e.primary.user.id));

  const stats = { total: entries.length, available: 0, onTheWay: 0, needsALook: 0 };
  const statusFacet = emptyStatusCounts();
  const sourceFacet: Record<LibrarySource, number> = { scan: 0, rmab: 0 };
  const requesterCounts = new Map<string, number>();
  const matched: LibraryEntry[] = [];

  for (const e of entries) {
    if (e.statusGroup === 'available') stats.available++;
    else if (e.statusGroup === 'on_the_way') stats.onTheWay++;
    else if (e.statusGroup === 'problem' || e.statusGroup === 'needs_approval') stats.needsALook++;

    if (filters.hideAvailable && e.statusGroup === 'available') continue;
    if (filters.tokens.length > 0 && !filters.tokens.every((t) => e.haystack.includes(t))) continue;

    const s = inStatus(e);
    const o = inSource(e);
    const r = inRequesters(e);
    if (o && r) statusFacet[e.statusGroup]++;
    if (s && r) sourceFacet[e.source]++;
    if (s && o && e.primary) requesterCounts.set(e.primary.user.id, (requesterCounts.get(e.primary.user.id) ?? 0) + 1);
    if (s && o && r) matched.push(e);
  }

  const requestedBy: RequestedByFacet[] = [...universe.entries()]
    .map(([userId, u]) => {
      const facet: RequestedByFacet = { userId, username: u.username, count: requesterCounts.get(userId) ?? 0 };
      if (u.deleted) facet.deleted = true;
      return facet;
    })
    .sort((a, b) => {
      const an = fold(a.username);
      const bn = fold(b.username);
      return an < bn ? -1 : an > bn ? 1 : a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
    });

  const keyed = matched.map((entry) => ({ entry, tuple: sortTupleOf(entry, spec) }));
  keyed.sort((a, b) => compareTuples(a.tuple, b.tuple, spec));

  return { sorted: keyed.map((k) => k.entry), stats, facets: { status: statusFacet, source: sourceFacet, requestedBy } };
}

/** Each author key's label (its first entry in sort order) and count over every match. */
function authorGroups(core: QueryCore): Map<string, { label: string; count: number }> {
  if (!core.groupsByAuthor) {
    const byKey = new Map<string, { label: string; count: number }>();
    for (const entry of core.sorted) {
      const g = byKey.get(entry.authorKey);
      if (g) g.count++;
      else byKey.set(entry.authorKey, { label: entry.author, count: 1 });
    }
    core.groupsByAuthor = byKey;
  }
  return core.groupsByAuthor;
}

/** One page of a computed query: keyset start after the cursor tuple, then limit entries. */
export function pageOf(core: QueryCore, spec: LibrarySortSpec, cursorTuple: SortTuple | null, limit: number): QueryResult {
  const { sorted } = core;
  // Keyset: first entry strictly after the cursor tuple (binary search; the list is sorted)
  let start = 0;
  if (cursorTuple) {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compareTuples(sortTupleOf(sorted[mid], spec), cursorTuple, spec) <= 0) lo = mid + 1;
      else hi = mid;
    }
    start = lo;
  }
  const page = sorted.slice(start, start + limit);
  const hasMore = start + limit < sorted.length;

  let groups: QueryResult['groups'] = null;
  if (spec.group === 'author') {
    const all = authorGroups(core);
    const seen = new Set<string>();
    groups = [];
    for (const entry of page) {
      if (seen.has(entry.authorKey)) continue;
      seen.add(entry.authorKey);
      const g = all.get(entry.authorKey)!;
      groups.push({ key: entry.authorKey, label: g.label, count: g.count });
    }
  }

  return {
    page,
    nextTuple: hasMore && page.length > 0 ? sortTupleOf(page[page.length - 1], spec) : null,
    matched: sorted.length,
    stats: core.stats,
    facets: core.facets,
    groups,
  };
}

export function runQuery(
  entries: readonly LibraryEntry[],
  filters: LibraryFilters,
  spec: LibrarySortSpec,
  cursorTuple: SortTuple | null,
  limit: number
): QueryResult {
  return pageOf(computeQuery(entries, filters, spec), spec, cursorTuple, limit);
}
