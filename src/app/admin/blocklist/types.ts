/**
 * Component: Admin Blocklist — Shared Types & Filter Contract
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * URL ↔ API param contract for the /admin/blocklist page. URL param names ===
 * API query param names — no translation layer.
 */

export const BLOCKLIST_PARAMS = {
  search: 'search',
  source: 'source',
  requestId: 'requestId',
  dateFrom: 'dateFrom',
  dateTo: 'dateTo',
  sortBy: 'sortBy',
  sortOrder: 'sortOrder',
  page: 'page',
  limit: 'limit',
} as const;

export const VALID_LIMITS = [25, 50, 100] as const;
export type ValidLimit = (typeof VALID_LIMITS)[number];

export const VALID_SOURCES = ['all', 'organize_fail', 'download_fail', 'manual'] as const;
export type BlockSourceFilter = (typeof VALID_SOURCES)[number];

export const VALID_SORT_FIELDS = ['createdAt', 'releaseName', 'reason'] as const;
export type SortField = (typeof VALID_SORT_FIELDS)[number];

export const VALID_SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof VALID_SORT_ORDERS)[number];

export const DEFAULT_LIMIT: ValidLimit = 50;
export const DEFAULT_PAGE = 1;
export const DEFAULT_SORT_BY: SortField = 'createdAt';
export const DEFAULT_SORT_ORDER: SortOrder = 'desc';

export interface BlocklistFilterState {
  search: string;
  source: BlockSourceFilter;
  requestId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  sortBy: SortField;
  sortOrder: SortOrder;
  page: number;
  limit: ValidLimit;
}

export const DEFAULT_FILTER_STATE: BlocklistFilterState = {
  search: '',
  source: 'all',
  requestId: null,
  dateFrom: null,
  dateTo: null,
  sortBy: DEFAULT_SORT_BY,
  sortOrder: DEFAULT_SORT_ORDER,
  page: DEFAULT_PAGE,
  limit: DEFAULT_LIMIT,
};

export const SOURCE_LABELS: Record<BlockSourceFilter, string> = {
  all: 'All sources',
  organize_fail: 'Organize failure',
  download_fail: 'Download failure',
  manual: 'Manual',
};

export const SOURCE_BADGE_LABEL: Record<string, string> = {
  organize_fail: 'Organize',
  download_fail: 'Download',
  manual: 'Manual',
};

// ---------------------------------------------------------------------------
// API response shape — mirrors the route's `select` projection.
// ---------------------------------------------------------------------------
export interface BlockedReleaseRequestRelation {
  id: string;
  deletedAt: string | null;
  audiobook: { title: string; author: string } | null;
  user: { plexUsername: string } | null;
}

export interface BlockedReleaseRow {
  id: string;
  requestId: string;
  releaseName: string;
  releaseHash: string | null;
  indexerName: string | null;
  indexerId: number | null;
  source: string;
  reason: string;
  reasonDetail: string | null;
  downloadHistoryId: string | null;
  jobId: string | null;
  createdAt: string;
  request: BlockedReleaseRequestRelation | null;
}

export interface BlocklistPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface BlocklistData {
  entries: BlockedReleaseRow[];
  pagination: BlocklistPagination;
}

// ---------------------------------------------------------------------------
// SWR / URL builders — single source of truth for the API query string.
// `buildBlocklistQueryString` is reused by the bulk-clear DELETE call so the
// clear-scope matches what the user sees.
// ---------------------------------------------------------------------------
export function buildBlocklistQueryString(state: BlocklistFilterState): string {
  const params = new URLSearchParams();
  params.set(BLOCKLIST_PARAMS.page, String(state.page));
  params.set(BLOCKLIST_PARAMS.limit, String(state.limit));

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

  return params.toString();
}

export function buildBlocklistApiKey(state: BlocklistFilterState): string {
  return `/api/admin/blocklist?${buildBlocklistQueryString(state)}`;
}

/**
 * Build the query string the bulk-clear DELETE call should use. Strips
 * page/limit/sort (irrelevant for delete scope) — only filter axes survive.
 */
export function buildBulkClearQueryString(state: BlocklistFilterState): string {
  const params = new URLSearchParams();
  if (state.source && state.source !== 'all') {
    params.set(BLOCKLIST_PARAMS.source, state.source);
  }
  if (state.requestId) params.set(BLOCKLIST_PARAMS.requestId, state.requestId);
  if (state.search) params.set(BLOCKLIST_PARAMS.search, state.search);
  if (state.dateFrom) params.set(BLOCKLIST_PARAMS.dateFrom, state.dateFrom);
  if (state.dateTo) params.set(BLOCKLIST_PARAMS.dateTo, state.dateTo);
  return params.toString();
}

// ---------------------------------------------------------------------------
// Filter-state predicates — drive empty-state copy + chip strip + Clear button
// ---------------------------------------------------------------------------
export function hasActiveFilters(state: BlocklistFilterState): boolean {
  return (
    state.source !== 'all' ||
    state.requestId !== null ||
    state.dateFrom !== null ||
    state.dateTo !== null
  );
}

export function hasActiveSearch(state: BlocklistFilterState): boolean {
  return state.search !== '';
}

export type EmptyStateKind = 'fresh' | 'filters-too-tight' | 'search-no-match';

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
