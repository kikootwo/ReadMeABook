/**
 * Component: Library page query state (URL <-> filters, sort, group; debounced search)
 * Documentation: documentation/features/library-view.md
 *
 * Reads q, status, source, requestedBy, sort and group from the URL, dropping anything the API
 * would refuse, so a hand-edited link never fails. Writes with router.replace (no history entries).
 * The URL is read again whenever it changes to something this hook did not write (the header's
 * Library link while on /library?q=x).
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  GROUP_MODES,
  MAX_QUERY_LENGTH,
  MAX_REQUESTED_BY,
  SORT_KEYS,
  SOURCES,
  STATUS_GROUPS,
} from '@/lib/library-view/constants';
import type { LibraryGroupMode, LibrarySortKey, LibrarySource, StatusGroup } from '@/lib/library-view/types';

export const SEARCH_DEBOUNCE_MS = 300;

export interface LibraryFilters {
  status: StatusGroup[];
  source: LibrarySource[];
  requestedBy: string[];
  sort: LibrarySortKey;
  group: LibraryGroupMode;
}

/** What the list is fetched with: the debounced search plus the filters. */
export interface LibraryQuery extends LibraryFilters {
  q: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function csv<T extends string>(value: string | null, allowed: readonly T[], max: number): T[] {
  if (!value) return [];
  const out: T[] = [];
  for (const part of value.split(',')) {
    const v = part.trim() as T;
    if (allowed.includes(v) && !out.includes(v) && out.length < max) out.push(v);
  }
  return out;
}

/** The query in a URL, with every value the API would refuse dropped. */
export function parseLibraryQuery(params: URLSearchParams): LibraryQuery {
  const ids: string[] = [];
  for (const part of (params.get('requestedBy') ?? '').split(',')) {
    const id = part.trim().toLowerCase();
    if (UUID.test(id) && !ids.includes(id) && ids.length < MAX_REQUESTED_BY) ids.push(id);
  }
  const sort = params.get('sort') as LibrarySortKey;
  const group = params.get('group') as LibraryGroupMode;
  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH),
    status: csv(params.get('status'), STATUS_GROUPS, STATUS_GROUPS.length),
    source: csv(params.get('source'), SOURCES, SOURCES.length),
    requestedBy: ids,
    sort: SORT_KEYS.includes(sort) ? sort : 'added',
    group: GROUP_MODES.includes(group) ? group : 'none',
  };
}

/** The page URL's query string (fixed order, defaults left out). */
export function libraryQueryString(query: LibraryQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status.length) params.set('status', query.status.join(','));
  if (query.source.length) params.set('source', query.source.join(','));
  if (query.requestedBy.length) params.set('requestedBy', query.requestedBy.join(','));
  if (query.sort !== 'added') params.set('sort', query.sort);
  if (query.group !== 'none') params.set('group', query.group);
  return params.toString();
}

function toggled<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function useLibraryQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlString = searchParams.toString();

  const initial = useMemo(() => parseLibraryQuery(new URLSearchParams(urlString)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [input, setInput] = useState(initial.q);
  const [q, setQ] = useState(initial.q);
  const [filters, setFilters] = useState<LibraryFilters>(() => {
    const { q: _q, ...rest } = initial; // eslint-disable-line @typescript-eslint/no-unused-vars
    return rest;
  });
  /** The query string this hook last wrote or adopted. */
  const intended = useRef(urlString);
  /** Strings written but not yet seen in the URL (router.replace is asynchronous). */
  const pending = useRef<string[]>([]);

  const query: LibraryQuery = useMemo(() => ({ q, ...filters }), [q, filters]);

  // Navigation to /library with another query (header link, back/forward): adopt it.
  useEffect(() => {
    const seen = pending.current.indexOf(urlString);
    if (seen >= 0) {
      pending.current.splice(0, seen + 1); // our own write (and any it superseded) arrived
      return;
    }
    if (urlString === intended.current) return;
    pending.current = [];
    intended.current = urlString;
    const next = parseLibraryQuery(new URLSearchParams(urlString));
    const { q: nextQ, ...rest } = next;
    setInput(nextQ);
    setQ(nextQ);
    setFilters(rest);
  }, [urlString]);

  // Debounce typing into the fetched query.
  useEffect(() => {
    const trimmed = input.trim().slice(0, MAX_QUERY_LENGTH);
    if (trimmed === q) return;
    const timer = setTimeout(() => setQ(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, q]);

  // Write the URL when the fetched query changes.
  useEffect(() => {
    const next = libraryQueryString(query);
    if (next === intended.current) return;
    intended.current = next;
    pending.current.push(next);
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [query, pathname, router]);

  const update = useCallback((patch: Partial<LibraryFilters>) => setFilters((f) => ({ ...f, ...patch })), []);

  return {
    query,
    input,
    setInput,
    toggleStatus: useCallback((s: StatusGroup) => setFilters((f) => ({ ...f, status: toggled(f.status, s) })), []),
    toggleSource: useCallback((s: LibrarySource) => setFilters((f) => ({ ...f, source: toggled(f.source, s) })), []),
    toggleRequestedBy: useCallback(
      (id: string) => setFilters((f) => ({ ...f, requestedBy: toggled(f.requestedBy, id) })),
      []
    ),
    setRequestedBy: useCallback((ids: string[]) => update({ requestedBy: ids }), [update]),
    setSort: useCallback((sort: LibrarySortKey) => update({ sort }), [update]),
    setGroup: useCallback((group: LibraryGroupMode) => update({ group }), [update]),
    clearFacet: useCallback(
      (facet: 'status' | 'source' | 'requestedBy') => update({ [facet]: [] } as Partial<LibraryFilters>),
      [update]
    ),
    clearSearch: useCallback(() => {
      setInput('');
      setQ('');
    }, []),
    /** Search and every filter (sort and group stay). */
    clearAll: useCallback(() => {
      setInput('');
      setQ('');
      update({ status: [], source: [], requestedBy: [] });
    }, [update]),
  };
}

export type LibraryQueryState = ReturnType<typeof useLibraryQuery>;
