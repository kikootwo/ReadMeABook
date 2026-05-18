/**
 * Component: Admin Logs — Shared Types & Filter Contract
 * Documentation: documentation/admin-dashboard.md
 *
 * Stage 0 contract: filter state shape + URL/API param names + SWR key helper.
 * URL param names === API param names — no translation layer.
 * `buildLogsApiKey` is the SWR key/test seam (frontend only — backend tests
 * assert against parsed URLSearchParams / where-clause).
 */

// ---------------------------------------------------------------------------
// Param names — used as BOTH URL search params AND API query string params.
// ---------------------------------------------------------------------------
export const LOG_PARAMS = {
  search: 'search',
  status: 'status',
  type: 'type',
  dateFrom: 'dateFrom',
  dateTo: 'dateTo',
  hasError: 'hasError',
  userId: 'userId',
  audiobookQuery: 'audiobookQuery',
  page: 'page',
  limit: 'limit',
} as const;

export type LogParamKey = keyof typeof LOG_PARAMS;

// ---------------------------------------------------------------------------
// Valid value sets
// ---------------------------------------------------------------------------
export const VALID_LIMITS = [25, 50, 100] as const;
export type ValidLimit = typeof VALID_LIMITS[number];

export const VALID_STATUSES = [
  'all',
  'pending',
  'active',
  'completed',
  'failed',
  'delayed',
  'stuck',
] as const;
export type LogStatus = typeof VALID_STATUSES[number];

export const DEFAULT_LIMIT: ValidLimit = 50;
export const DEFAULT_PAGE = 1;

// ---------------------------------------------------------------------------
// Filter state — single source of truth, both URL hydration target and API input
// ---------------------------------------------------------------------------
export interface LogsFilterState {
  search: string;                  // '' = no search
  status: string;                  // 'all' default; validated against VALID_STATUSES on read
  type: string;                    // 'all' default; validated against JOB_TYPE_LABELS keys on read
  dateFrom: string | null;         // ISO UTC; null = no lower bound
  dateTo: string | null;           // ISO UTC; null = no upper bound
  hasError: boolean;               // false default
  userId: string | null;           // null = any user
  audiobookQuery: string;          // '' = no book filter
  page: number;                    // 1-based
  limit: ValidLimit;               // 25 | 50 | 100
}

export const DEFAULT_FILTER_STATE: LogsFilterState = {
  search: '',
  status: 'all',
  type: 'all',
  dateFrom: null,
  dateTo: null,
  hasError: false,
  userId: null,
  audiobookQuery: '',
  page: DEFAULT_PAGE,
  limit: DEFAULT_LIMIT,
};

// ---------------------------------------------------------------------------
// Log data types — match the existing API response shape
// (which mirrors prisma Job + JobEvent + Request joins)
// ---------------------------------------------------------------------------
export interface JobEvent {
  id: string;
  level: 'info' | 'warn' | 'error' | string;
  context: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface LogRequestRelation {
  id: string;
  audiobook: {
    title: string;
    author: string;
  } | null;
  user: {
    plexUsername: string;
  };
}

export interface Log {
  id: string;
  bullJobId: string | null;
  type: string;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  result: Record<string, unknown> | null;
  events: JobEvent[];
  request: LogRequestRelation | null;
}

export interface LogsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface LogsData {
  logs: Log[];
  pagination: LogsPagination;
}

// ---------------------------------------------------------------------------
// API key / URL builder — single source of truth shared by SWR and tests.
// Omits params at their default values so the key stays stable & short.
// ---------------------------------------------------------------------------
export function buildLogsApiKey(state: LogsFilterState): string {
  const params = new URLSearchParams();

  // page + limit are always present so SWR cache keys are deterministic
  params.set(LOG_PARAMS.page, String(state.page));
  params.set(LOG_PARAMS.limit, String(state.limit));

  if (state.status && state.status !== 'all') params.set(LOG_PARAMS.status, state.status);
  if (state.type && state.type !== 'all') params.set(LOG_PARAMS.type, state.type);
  if (state.search) params.set(LOG_PARAMS.search, state.search);
  if (state.dateFrom) params.set(LOG_PARAMS.dateFrom, state.dateFrom);
  if (state.dateTo) params.set(LOG_PARAMS.dateTo, state.dateTo);
  if (state.hasError) params.set(LOG_PARAMS.hasError, '1');
  if (state.userId) params.set(LOG_PARAMS.userId, state.userId);
  if (state.audiobookQuery) params.set(LOG_PARAMS.audiobookQuery, state.audiobookQuery);

  return `/api/admin/logs?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Detail-panel predicate — does this log have anything worth disclosing?
// ---------------------------------------------------------------------------
export function logHasDetails(log: Log): boolean {
  return (
    log.events.length > 0 ||
    !!log.errorMessage ||
    !!log.bullJobId ||
    (log.result != null && Object.keys(log.result).length > 0)
  );
}

// ---------------------------------------------------------------------------
// Active-filter detection — drives empty-state copy + "Clear all" affordance
// ---------------------------------------------------------------------------
export function hasActiveFilters(state: LogsFilterState): boolean {
  return (
    state.status !== 'all' ||
    state.type !== 'all' ||
    state.dateFrom !== null ||
    state.dateTo !== null ||
    state.hasError ||
    state.userId !== null ||
    state.audiobookQuery !== ''
  );
}

export function hasActiveSearch(state: LogsFilterState): boolean {
  return state.search !== '';
}

export type EmptyStateKind =
  | 'fresh'                  // no rows, no filters, no search
  | 'filters-too-tight'      // no rows, filters active, no search
  | 'search-no-match';       // no rows, search active (filters may or may not be active)

export function computeEmptyState(args: {
  total: number;
  hasFilters: boolean;
  hasSearch: boolean;
}): EmptyStateKind | null {
  if (args.total > 0) return null;
  if (args.hasSearch) return 'search-no-match';
  if (args.hasFilters) return 'filters-too-tight';
  return 'fresh';
}
