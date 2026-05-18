/**
 * Component: useLogsUrlState Hook
 * Documentation: documentation/admin-dashboard.md
 *
 * URL ↔ typed filter state. URL is the single source of truth.
 * - reads URL params on every render (validated; invalid values silently dropped)
 * - writes URL via router.replace (no history pollution)
 * - search input writes are debounced (300ms) so typing feels instant
 * - any non-page filter change resets page to 1
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { JOB_TYPE_LABELS } from '@/lib/constants/job-labels';
import { DEFAULT_DATE_PRESET_ID, presetToRange } from '@/lib/constants/log-filters';
import {
  DEFAULT_FILTER_STATE,
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  LOG_PARAMS,
  LogsFilterState,
  VALID_LIMITS,
  VALID_STATUSES,
  ValidLimit,
} from '../types';

const SEARCH_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// URL → typed state (silently drops invalid values)
// ---------------------------------------------------------------------------
function parseFromUrl(params: URLSearchParams): LogsFilterState {
  const status = params.get(LOG_PARAMS.status);
  const type = params.get(LOG_PARAMS.type);
  const dateFrom = params.get(LOG_PARAMS.dateFrom);
  const dateTo = params.get(LOG_PARAMS.dateTo);
  const hasError = params.get(LOG_PARAMS.hasError);
  const userId = params.get(LOG_PARAMS.userId);
  const audiobookQuery = params.get(LOG_PARAMS.audiobookQuery);
  const search = params.get(LOG_PARAMS.search);
  const pageRaw = params.get(LOG_PARAMS.page);
  const limitRaw = params.get(LOG_PARAMS.limit);

  // Page: positive int or default
  let page = DEFAULT_PAGE;
  if (pageRaw) {
    const parsed = Number.parseInt(pageRaw, 10);
    if (Number.isFinite(parsed) && parsed >= 1) page = parsed;
  }

  // Limit: must be in VALID_LIMITS or default
  let limit: ValidLimit = DEFAULT_LIMIT;
  if (limitRaw) {
    const parsed = Number.parseInt(limitRaw, 10);
    if ((VALID_LIMITS as readonly number[]).includes(parsed)) {
      limit = parsed as ValidLimit;
    }
  }

  // Status: must be in VALID_STATUSES or default to 'all'
  const validStatus =
    status && (VALID_STATUSES as readonly string[]).includes(status) ? status : 'all';

  // Type: must be in JOB_TYPE_LABELS or default to 'all'
  const validType = type && (type === 'all' || type in JOB_TYPE_LABELS) ? type : 'all';

  // Date: must parse as a valid date or null
  const validDateFrom = isValidIsoDate(dateFrom) ? dateFrom : null;
  const validDateTo = isValidIsoDate(dateTo) ? dateTo : null;

  return {
    search: search ?? '',
    status: validStatus,
    type: validType,
    dateFrom: validDateFrom,
    dateTo: validDateTo,
    hasError: hasError === '1' || hasError === 'true',
    userId: userId && userId.length > 0 ? userId : null,
    audiobookQuery: audiobookQuery ?? '',
    page,
    limit,
  };
}

function isValidIsoDate(value: string | null): value is string {
  if (!value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// typed state → URLSearchParams (omits defaults so URLs stay short)
// ---------------------------------------------------------------------------
function serializeToUrl(state: LogsFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.page !== DEFAULT_PAGE) params.set(LOG_PARAMS.page, String(state.page));
  if (state.limit !== DEFAULT_LIMIT) params.set(LOG_PARAMS.limit, String(state.limit));
  if (state.status && state.status !== 'all') params.set(LOG_PARAMS.status, state.status);
  if (state.type && state.type !== 'all') params.set(LOG_PARAMS.type, state.type);
  if (state.search) params.set(LOG_PARAMS.search, state.search);
  if (state.dateFrom) params.set(LOG_PARAMS.dateFrom, state.dateFrom);
  if (state.dateTo) params.set(LOG_PARAMS.dateTo, state.dateTo);
  if (state.hasError) params.set(LOG_PARAMS.hasError, '1');
  if (state.userId) params.set(LOG_PARAMS.userId, state.userId);
  if (state.audiobookQuery) params.set(LOG_PARAMS.audiobookQuery, state.audiobookQuery);
  return params;
}

// ---------------------------------------------------------------------------
// Public hook
// ---------------------------------------------------------------------------
export interface UseLogsUrlStateResult {
  filters: LogsFilterState;
  /** Merge partial state; any non-page change resets page to 1. */
  setFilters: (partial: Partial<LogsFilterState>) => void;
  /** Set the search string; debounced URL write (300ms). UI value is immediate. */
  setSearchInput: (value: string) => void;
  /** The non-debounced search value (what the user is currently typing). */
  searchInput: string;
  /** Reset to DEFAULT_FILTER_STATE. */
  clearAll: () => void;
  /** Remove a single filter (reset to its default). Resets page to 1. */
  removeFilter: (key: keyof LogsFilterState) => void;
  /**
   * True iff the current `filters.dateFrom`/`dateTo` come from the Zach #1
   * hydrate-time "Last 7 days" default (URL had neither bound and user hasn't
   * touched anything yet). Page uses this to pick "fresh" vs "filters-too-tight"
   * empty-state copy — the hydrate default shouldn't be treated as a
   * user-applied filter.
   */
  usingHydrateDateDefault: boolean;
}

export function useLogsUrlState(): UseLogsUrlStateResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Zach Resolution #1: on FIRST mount, if the URL has neither dateFrom nor
  // dateTo, apply "Last 7 days" as the active range — but do NOT write those
  // values to the URL (keeps shareable links clean). The default lives only
  // in this hook's memory; the user's NEXT action (click All-time, change any
  // other filter, etc.) writes the URL with the then-effective values.
  //
  // Mechanism: a one-shot hydrate range stored in a ref. It's used to backfill
  // dates ONLY while:
  //   (a) the user hasn't taken an action that touched the date filter, AND
  //   (b) the URL still has neither dateFrom nor dateTo.
  // Either condition flipping false retires the hydrate default forever.
  const hydrateRangeRef = useRef<{ dateFrom: string | null; dateTo: string | null } | null>(
    null
  );
  const dateInteractedRef = useRef(false);
  if (hydrateRangeRef.current === null && !dateInteractedRef.current) {
    hydrateRangeRef.current = presetToRange(DEFAULT_DATE_PRESET_ID);
  }

  // Parse from URL on every render — URL is the source of truth.
  // Then layer the hydrate default on top when applicable.
  const { filters, usingHydrateDateDefault } = useMemo(() => {
    const parsed = parseFromUrl(new URLSearchParams(searchParams?.toString() ?? ''));
    const hydrate = hydrateRangeRef.current;
    if (
      hydrate &&
      !dateInteractedRef.current &&
      parsed.dateFrom === null &&
      parsed.dateTo === null
    ) {
      return {
        filters: {
          ...parsed,
          dateFrom: hydrate.dateFrom,
          dateTo: hydrate.dateTo,
        },
        usingHydrateDateDefault: true,
      };
    }
    return { filters: parsed, usingHydrateDateDefault: false };
  }, [searchParams]);

  // Local "search input" mirrors URL but updates immediately for typing feel.
  const [searchInput, setSearchInputState] = useState(filters.search);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync local search input if the URL search changes externally
  // (e.g. user clicks the search chip's × — chip dismissal sets URL,
  // we need to mirror that back to the input).
  useEffect(() => {
    setSearchInputState(filters.search);
    // We only want to sync from URL → input when the URL changes —
    // not when the user is mid-type.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  const writeUrl = useCallback(
    (nextState: LogsFilterState) => {
      // Any user-driven URL write retires the hydrate default. The just-written
      // URL is now authoritative — either it carries the hydrate dates (if the
      // user touched something else and the merge preserved them) or it
      // doesn't (if the user explicitly cleared them). Either way, subsequent
      // renders must trust the URL, not re-apply the default.
      dateInteractedRef.current = true;
      const qs = serializeToUrl(nextState).toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      router.replace(url, { scroll: false });
    },
    [pathname, router]
  );

  const setFilters = useCallback(
    (partial: Partial<LogsFilterState>) => {
      // Any non-page change resets page to 1.
      const isOnlyPageChange =
        Object.keys(partial).length === 1 && Object.prototype.hasOwnProperty.call(partial, 'page');
      const next: LogsFilterState = {
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
        const next: LogsFilterState = {
          ...filters,
          search: value,
          page: DEFAULT_PAGE,
        };
        writeUrl(next);
      }, SEARCH_DEBOUNCE_MS);
    },
    [filters, writeUrl]
  );

  // Clear any pending debounce on unmount.
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
    (key: keyof LogsFilterState) => {
      const defaultValue = DEFAULT_FILTER_STATE[key];
      const next: LogsFilterState = {
        ...filters,
        [key]: defaultValue,
        page: DEFAULT_PAGE,
      } as LogsFilterState;
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
    usingHydrateDateDefault,
  };
}
