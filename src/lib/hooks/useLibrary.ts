/**
 * Component: Library page data (list pages + live overlay + settle)
 * Documentation: documentation/features/library-view.md
 *
 * The list (GET /api/library) loads page by page and never refreshes on an interval, focus or
 * reconnect. It revalidates (every loaded page, through the bound mutate) on mount and whenever the
 * page returns to a query that is already cached, after an action, and on a settle: a live id that
 * leaves the live set, or a live status that moves a loaded card to another status group. Live
 * (`?live=1`) polls at the server's refreshMs and only patches status/progress of loaded cards,
 * never an in-library card; an unknown live id is ignored.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import useSWRInfinite, { unstable_serialize } from 'swr/infinite';
import { fetchWithAuth } from '@/lib/utils/api';
import { DEFAULT_LIMIT, STATUS_GROUP_OF } from '@/lib/library-view/constants';
import type { LibraryItem, LibraryLiveItem, LibraryLiveResponse, LibraryResponse } from '@/lib/library-view/types';
import type { LibraryQuery } from './useLibraryQuery';

export const LIVE_KEY = '/api/library?live=1';
export const SETTLE_DELAY_MS = 1000;
export const SETTLE_JITTER_MS = 1000;
export const LIVE_RETRY_MS = 5000;
const LIVE_RETRY_MAX_MS = 30000;
const MAX_RETRIES = 2;

export class LibraryFetchError extends Error {
  constructor(message: string, readonly status: number | undefined, readonly code?: string) {
    super(message);
    this.name = 'LibraryFetchError';
  }
}

/** One list page, tagged with the query it was fetched for (so stale data is never shown as fresh). */
export type LibraryPage = LibraryResponse & { base: string };

/** The list request for a query (fixed parameter order, defaults left out; `order` is never sent). */
export function libraryListKey(query: LibraryQuery, hideAvailable: boolean): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status.length) params.set('status', query.status.join(','));
  if (query.source.length) params.set('source', query.source.join(','));
  if (query.requestedBy.length) params.set('requestedBy', query.requestedBy.join(','));
  if (hideAvailable) params.set('hideAvailable', 'true');
  if (query.sort !== 'added') params.set('sort', query.sort);
  if (query.group !== 'none') params.set('group', query.group);
  params.set('limit', String(DEFAULT_LIMIT));
  return `/api/library?${params.toString()}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithAuth(url);
  } catch (error) {
    throw new LibraryFetchError(error instanceof Error ? error.message : 'Network error', undefined);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new LibraryFetchError(body?.message || `HTTP ${res.status}`, res.status, body?.error);
  return body as T;
}

async function fetchPage(url: string): Promise<LibraryPage> {
  const body = await fetchJson<LibraryResponse>(url);
  return { ...body, base: url.split('&cursor=')[0] };
}

/**
 * A failed live poll is retried quietly (5xx or network: 5 s, doubling to 30 s), never on a 4xx.
 * SWR's interval skips a key that holds an error, so without a retry one failure stops polling.
 */
function onLiveErrorRetry(
  error: LibraryFetchError,
  _key: string,
  _config: unknown,
  revalidate: (opts: { retryCount: number }) => void,
  { retryCount }: { retryCount: number }
) {
  if (error.status !== undefined && error.status < 500) return;
  setTimeout(() => revalidate({ retryCount }), Math.min(LIVE_RETRY_MS * 2 ** (retryCount - 1), LIVE_RETRY_MAX_MS));
}

/** No retry on a 4xx; at most two on a 5xx or a network failure. */
function onErrorRetry(
  error: LibraryFetchError,
  _key: string,
  _config: unknown,
  revalidate: (opts: { retryCount: number }) => void,
  { retryCount }: { retryCount: number }
) {
  if (error.status !== undefined && error.status < 500) return;
  if (retryCount > MAX_RETRIES) return;
  setTimeout(() => revalidate({ retryCount }), 1000 * 2 ** (retryCount - 1));
}

/**
 * A live entry applied to a loaded card (never to an in-library card). A new status drops the
 * request's error: it belonged to the status the list sent with it.
 */
export function applyLive(item: LibraryItem, live: LibraryLiveItem | undefined): LibraryItem {
  if (!live || item.inLibrary) return item;
  const statusGroup = STATUS_GROUP_OF[live.status] ?? item.statusGroup;
  const progress = statusGroup === 'on_the_way' ? live.progress : null;
  if (live.status === item.status && progress === item.progress && statusGroup === item.statusGroup) return item;
  const request =
    live.status !== item.status && item.request?.errorMessage ? { ...item.request, errorMessage: null } : item.request;
  return { ...item, status: live.status, statusGroup, progress, request };
}

interface MergedPages {
  items: LibraryItem[];
  first: LibraryPage | null;
  matched: number;
  groups: Map<string, { label: string; count: number }>;
  hasMore: boolean;
}

function mergePages(pages: LibraryPage[] | undefined): MergedPages {
  const seen = new Set<string>();
  const items: LibraryItem[] = [];
  const groups = new Map<string, { label: string; count: number }>();
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue; // first wins
      seen.add(item.id);
      items.push(item);
    }
    for (const g of page.groups ?? []) if (!groups.has(g.key)) groups.set(g.key, { label: g.label, count: g.count });
  }
  const last = pages?.[pages.length - 1];
  return { items, first: pages?.[0] ?? null, matched: last?.matched ?? 0, groups, hasMore: !!last?.nextCursor };
}

export function useLibrary(query: LibraryQuery, hideAvailable: boolean, enabled: boolean) {
  const { cache } = useSWRConfig();
  const base = enabled ? libraryListKey(query, hideAvailable) : null;

  const getKey = useCallback(
    (index: number, previous: LibraryPage | null) => {
      if (!base) return null;
      if (index === 0) return base;
      if (!previous?.nextCursor) return null;
      return `${base}&cursor=${encodeURIComponent(previous.nextCursor)}`;
    },
    [base]
  );

  const list = useSWRInfinite<LibraryPage, LibraryFetchError>(getKey, fetchPage, {
    revalidateFirstPage: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    keepPreviousData: true,
    onErrorRetry,
  });
  const { data: pages, error, size, setSize, mutate, isValidating } = list;
  const mutateRef = useRef(mutate);
  useEffect(() => {
    mutateRef.current = mutate;
  }, [mutate]);

  // Mount, or a return to a query whose pages are cached: SWR would show them without fetching.
  useEffect(() => {
    if (!base) return;
    const cached = cache.get(unstable_serialize(() => base));
    if (cached?.data !== undefined) void mutate();
  }, [base, cache, mutate]);

  const merged = useMemo(() => mergePages(pages), [pages]);
  /** The shown pages belong to another query (kept while the new one loads). */
  const lagging = !!merged.first && merged.first.base !== base;

  // A cursor from other filters or a damaged one: start over from page 1.
  useEffect(() => {
    if (error?.code === 'StaleCursor' || error?.code === 'BadCursor') {
      void setSize(1).then(() => mutate());
    }
  }, [error, setSize, mutate]);

  const live = useSWR<LibraryLiveResponse, LibraryFetchError>(merged.first ? LIVE_KEY : null, fetchJson, {
    refreshInterval: (latest) => latest?.refreshMs ?? 0,
    revalidateOnFocus: true,
    onErrorRetry: onLiveErrorRetry, // quiet: the last overlay stays meanwhile
  });
  const mutateLive = live.mutate;

  // Every later list fetch also refreshes live (and restarts its interval after it stopped at 0).
  // The first pages need no call: live starts with them.
  const previousPages = useRef(pages);
  useEffect(() => {
    if (pages === previousPages.current) return;
    const hadPages = previousPages.current !== undefined;
    previousPages.current = pages;
    if (hadPages && pages) void mutateLive();
  }, [pages, mutateLive]);

  const liveById = useMemo(() => new Map((live.data?.items ?? []).map((i) => [i.id, i])), [live.data]);
  const items = useMemo(() => merged.items.map((item) => applyLive(item, liveById.get(item.id))), [merged.items, liveById]);

  // Settle: one debounced, jittered revalidation of every loaded page.
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSettle = useCallback(() => {
    if (settleTimer.current) return; // coalesced
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      void mutateRef.current();
    }, SETTLE_DELAY_MS + Math.random() * SETTLE_JITTER_MS);
  }, []);
  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  // A live id that leaves the live set.
  const previousLiveIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!live.data) return;
    const ids = new Set(live.data.items.map((i) => i.id));
    let left = false;
    for (const id of previousLiveIds.current ?? []) if (!ids.has(id)) left = true;
    previousLiveIds.current = ids;
    if (left) scheduleSettle();
  }, [live.data, scheduleSettle]);

  // A live status that moves a loaded card to another group. Checked again when the pages change,
  // never while a list fetch runs (its result is checked when it lands, so an action costs one reload).
  const groupMovesSeen = useRef(new Set<string>());
  useEffect(() => {
    if (!live.data || isValidating) return;
    const loaded = new Map(merged.items.map((i) => [i.id, i]));
    let settle = false;
    for (const entry of live.data.items) {
      const item = loaded.get(entry.id);
      const group = STATUS_GROUP_OF[entry.status];
      if (!item || item.inLibrary || !group) continue;
      const move = `${entry.id}:${entry.status}`; // once per move, so a lagging list cannot loop
      if (group === item.statusGroup) {
        groupMovesSeen.current.delete(move); // the list caught up: the same move later settles again
        continue;
      }
      if (!groupMovesSeen.current.has(move)) {
        groupMovesSeen.current.add(move);
        settle = true;
      }
    }
    if (settle) scheduleSettle();
  }, [live.data, merged.items, isValidating, scheduleSettle]);

  /** After an action: the list (every loaded page) and live; a pending settle is folded into it. */
  const revalidate = useCallback(async () => {
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    await Promise.all([mutateRef.current(), mutateLive()]);
  }, [mutateLive]);

  /** A new query failed while the old one's pages were still shown: show neither. */
  const failedNew = lagging && !!error;
  const first = failedNew ? null : merged.first;
  return {
    items: failedNew ? [] : items,
    stats: first?.stats ?? null,
    facets: first?.facets ?? null,
    viewer: first?.viewer ?? null,
    backend: first?.backend ?? null,
    libraryConfigured: first?.libraryConfigured ?? true,
    matched: failedNew ? 0 : merged.matched,
    groups: merged.groups,
    hasMore: !lagging && merged.hasMore,
    /** Nothing to show yet for this query. */
    isLoading: enabled && !error && !first,
    // Only while a fetch runs: a reload that ends a page earlier leaves size above pages.length
    isLoadingMore: isValidating && !!pages && size > pages.length && !error,
    isValidating,
    lagging,
    error: error ?? null,
    loaded: !!first,
    /** 0 unless polling really runs (a failed poll turns it off until a retry succeeds). */
    liveRefreshMs: live.error ? 0 : live.data?.refreshMs ?? 0,
    liveIds: liveById,
    loadMore: useCallback(() => void setSize((s) => s + 1), [setSize]),
    retry: useCallback(() => void mutateRef.current(), []),
    revalidate,
    /** A snapshot item patched with the latest live entry (the open detail). */
    withLive: useCallback((item: LibraryItem) => applyLive(item, liveById.get(item.id)), [liveById]),
  };
}

export type LibraryData = ReturnType<typeof useLibrary>;
