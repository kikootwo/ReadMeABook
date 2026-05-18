/**
 * Component: useBlocklistUrlState Hook
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * URL ↔ typed filter state for /admin/blocklist. URL is the source of truth.
 * Sibling of useLogsUrlState — no shared date hydrate default here because
 * the blocklist defaults to "All time" (admin needs to see everything by
 * default; data set is small).
 *
 * - Reads URL params on every render (invalid values silently dropped).
 * - Writes URL via router.replace (no history pollution).
 * - Debounces search input writes (300ms) so typing feels instant.
 * - Any non-page filter change resets page to 1.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  BLOCKLIST_PARAMS,
  BlocklistFilterState,
  BlockSourceFilter,
  DEFAULT_FILTER_STATE,
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
  SortField,
  SortOrder,
  VALID_LIMITS,
  VALID_SORT_FIELDS,
  VALID_SORT_ORDERS,
  VALID_SOURCES,
  ValidLimit,
} from '../types';

const SEARCH_DEBOUNCE_MS = 300;

function isValidIsoDate(value: string | null): value is string {
  if (!value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function parseFromUrl(params: URLSearchParams): BlocklistFilterState {
  const search = params.get(BLOCKLIST_PARAMS.search);
  const sourceRaw = params.get(BLOCKLIST_PARAMS.source);
  const requestId = params.get(BLOCKLIST_PARAMS.requestId);
  const dateFrom = params.get(BLOCKLIST_PARAMS.dateFrom);
  const dateTo = params.get(BLOCKLIST_PARAMS.dateTo);
  const sortByRaw = params.get(BLOCKLIST_PARAMS.sortBy);
  const sortOrderRaw = params.get(BLOCKLIST_PARAMS.sortOrder);
  const pageRaw = params.get(BLOCKLIST_PARAMS.page);
  const limitRaw = params.get(BLOCKLIST_PARAMS.limit);

  let page = DEFAULT_PAGE;
  if (pageRaw) {
    const parsed = Number.parseInt(pageRaw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) page = parsed;
  }

  let limit: ValidLimit = DEFAULT_LIMIT;
  if (limitRaw) {
    const parsed = Number.parseInt(limitRaw, 10);
    if ((VALID_LIMITS as readonly number[]).includes(parsed)) {
      limit = parsed as ValidLimit;
    }
  }

  const source: BlockSourceFilter =
    sourceRaw && (VALID_SOURCES as readonly string[]).includes(sourceRaw)
      ? (sourceRaw as BlockSourceFilter)
      : 'all';

  const sortBy: SortField =
    sortByRaw && (VALID_SORT_FIELDS as readonly string[]).includes(sortByRaw)
      ? (sortByRaw as SortField)
      : DEFAULT_SORT_BY;

  const sortOrder: SortOrder =
    sortOrderRaw && (VALID_SORT_ORDERS as readonly string[]).includes(sortOrderRaw)
      ? (sortOrderRaw as SortOrder)
      : DEFAULT_SORT_ORDER;

  return {
    search: search ?? '',
    source,
    requestId: requestId && requestId.length > 0 ? requestId : null,
    dateFrom: isValidIsoDate(dateFrom) ? dateFrom : null,
    dateTo: isValidIsoDate(dateTo) ? dateTo : null,
    sortBy,
    sortOrder,
    page,
    limit,
  };
}

function serializeToUrl(state: BlocklistFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.page !== DEFAULT_PAGE) params.set(BLOCKLIST_PARAMS.page, String(state.page));
  if (state.limit !== DEFAULT_LIMIT) params.set(BLOCKLIST_PARAMS.limit, String(state.limit));
  if (state.source && state.source !== 'all') {
    params.set(BLOCKLIST_PARAMS.source, state.source);
  }
  if (state.requestId) params.set(BLOCKLIST_PARAMS.requestId, state.requestId);
  if (state.search) params.set(BLOCKLIST_PARAMS.search, state.search);
  if (state.dateFrom) params.set(BLOCKLIST_PARAMS.dateFrom, state.dateFrom);
  if (state.dateTo) params.set(BLOCKLIST_PARAMS.dateTo, state.dateTo);
  if (state.sortBy !== DEFAULT_SORT_BY) params.set(BLOCKLIST_PARAMS.sortBy, state.sortBy);
  if (state.sortOrder !== DEFAULT_SORT_ORDER) {
    params.set(BLOCKLIST_PARAMS.sortOrder, state.sortOrder);
  }
  return params;
}

export interface UseBlocklistUrlStateResult {
  filters: BlocklistFilterState;
  setFilters: (partial: Partial<BlocklistFilterState>) => void;
  setSearchInput: (value: string) => void;
  searchInput: string;
  clearAll: () => void;
  removeFilter: (key: keyof BlocklistFilterState) => void;
}

export function useBlocklistUrlState(): UseBlocklistUrlStateResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(
    () => parseFromUrl(new URLSearchParams(searchParams?.toString() ?? '')),
    [searchParams]
  );

  const [searchInput, setSearchInputState] = useState(filters.search);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSearchInputState(filters.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  const writeUrl = useCallback(
    (nextState: BlocklistFilterState) => {
      const qs = serializeToUrl(nextState).toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      router.replace(url, { scroll: false });
    },
    [pathname, router]
  );

  const setFilters = useCallback(
    (partial: Partial<BlocklistFilterState>) => {
      const isOnlyPageChange =
        Object.keys(partial).length === 1 &&
        Object.prototype.hasOwnProperty.call(partial, 'page');
      const next: BlocklistFilterState = {
        ...filters,
        ...partial,
        page: isOnlyPageChange ? (partial.page ?? filters.page) : DEFAULT_PAGE,
      };
      writeUrl(next);
    },
    [filters, writeUrl]
  );

  const setSearchInput = useCallback(
    (value: string) => {
      setSearchInputState(value);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        const next: BlocklistFilterState = {
          ...filters,
          search: value,
          page: DEFAULT_PAGE,
        };
        writeUrl(next);
      }, SEARCH_DEBOUNCE_MS);
    },
    [filters, writeUrl]
  );

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const clearAll = useCallback(() => {
    writeUrl(DEFAULT_FILTER_STATE);
    setSearchInputState('');
  }, [writeUrl]);

  const removeFilter = useCallback(
    (key: keyof BlocklistFilterState) => {
      const defaultValue = DEFAULT_FILTER_STATE[key];
      const next: BlocklistFilterState = {
        ...filters,
        [key]: defaultValue,
        page: DEFAULT_PAGE,
      } as BlocklistFilterState;
      writeUrl(next);
      if (key === 'search') setSearchInputState('');
    },
    [filters, writeUrl]
  );

  return {
    filters,
    setFilters,
    setSearchInput,
    searchInput,
    clearAll,
    removeFilter,
  };
}
