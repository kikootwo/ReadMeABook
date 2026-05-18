/**
 * Component: Admin System Logs Page
 * Documentation: documentation/admin-dashboard.md
 *
 * Thin orchestrator: reads URL via useLogsUrlState, owns SWR + pause registry,
 * composes sub-components. Empty-state copy as a pure function of
 * { totalResults, hasActiveFilters, hasActiveSearch }.
 */

'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { ToastProvider } from '@/components/ui/Toast';
import { authenticatedFetcher } from '@/lib/utils/api';
import {
  buildLogsApiKey,
  computeEmptyState,
  hasActiveFilters,
  hasActiveSearch,
  Log,
  LogsData,
  ValidLimit,
} from './types';
import { useLogsUrlState } from './hooks/useLogsUrlState';
import {
  AutoRefreshControlProvider,
  useAutoRefreshControl,
} from './hooks/useAutoRefreshControl';
import { LogsToolbar } from './components/LogsToolbar';
import { LogSkeleton } from './components/LogSkeleton';
import { LogsPagination } from './components/LogsPagination';
import { LogRow } from './components/LogRow';
import LogsFilters from './components/LogsFilters';
import ActiveFilterChips from './components/ActiveFilterChips';

function EmptyState({
  kind,
  onClearFilters,
  onClearSearch,
  searchValue,
}: {
  kind: 'fresh' | 'filters-too-tight' | 'search-no-match';
  onClearFilters: () => void;
  onClearSearch: () => void;
  searchValue: string;
}) {
  if (kind === 'fresh') {
    return (
      <div className="text-center py-16">
        <p className="text-gray-700 dark:text-gray-300 text-base font-medium">
          No background jobs have run yet.
        </p>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          New jobs will appear here as they start.
        </p>
      </div>
    );
  }
  if (kind === 'search-no-match') {
    return (
      <div className="text-center py-16">
        <p className="text-gray-700 dark:text-gray-300 text-base font-medium">
          No matches for &ldquo;{searchValue}&rdquo;.
        </p>
        <button
          type="button"
          onClick={onClearSearch}
          aria-label="Clear search and show all logs"
          className="mt-3 inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
        >
          Clear search
        </button>
      </div>
    );
  }
  return (
    <div className="text-center py-16">
      <p className="text-gray-700 dark:text-gray-300 text-base font-medium">
        No logs match your current filters.
      </p>
      <button
        type="button"
        onClick={onClearFilters}
        className="mt-3 inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
      >
        Clear filters
      </button>
    </div>
  );
}

function AdminLogsPageContent() {
  const { filters, setFilters, clearAll, usingHydrateDateDefault } = useLogsUrlState();
  const { effectiveInterval, setMutate, setLastUpdatedAt } = useAutoRefreshControl();

  const key = buildLogsApiKey(filters);

  // Track previous key to distinguish initial-load / filter-change skeleton
  // from auto-refresh (which preserves rows).
  const previousKeyRef = useRef<string>(key);
  const [keyChanging, setKeyChanging] = useState(false);

  const { data, error, mutate } = useSWR<LogsData>(key, authenticatedFetcher, {
    refreshInterval: effectiveInterval,
    keepPreviousData: true,
  });

  // Wire SWR's mutate into the auto-refresh control so "Refresh now" works.
  useEffect(() => {
    setMutate(() => mutate());
    return () => setMutate(null);
  }, [mutate, setMutate]);

  // Broadcast a "fresh data" timestamp when SWR data lands.
  useEffect(() => {
    if (data) setLastUpdatedAt(Date.now());
  }, [data, setLastUpdatedAt]);

  // Skeleton-vs-rows decision:
  //   - !data → initial skeleton.
  //   - key changed AND no data for the new key yet → skeleton on transition.
  // SWR's `keepPreviousData` makes data === previous response until the new
  // one lands, so we explicitly track key changes.
  useEffect(() => {
    if (previousKeyRef.current !== key) {
      previousKeyRef.current = key;
      setKeyChanging(true);
    }
  }, [key]);

  useEffect(() => {
    if (keyChanging && data) setKeyChanging(false);
  }, [data, keyChanging]);

  const showSkeleton = !data || keyChanging;
  const logs: Log[] = data?.logs ?? [];
  const pagination = data?.pagination ?? { page: filters.page, limit: filters.limit, total: 0, totalPages: 1 };

  // When the hydrate-time "Last 7 days" default is in effect (the user hasn't
  // explicitly chosen a date range), don't count it as a user-applied filter
  // for empty-state branching — show the "fresh" message, not "filters too
  // tight". hasActiveFilters() is otherwise the canonical check.
  const filtersForEmptyState = usingHydrateDateDefault
    ? { ...filters, dateFrom: null, dateTo: null }
    : filters;
  const emptyKind = computeEmptyState({
    total: pagination.total,
    hasFilters: hasActiveFilters(filtersForEmptyState),
    hasSearch: hasActiveSearch(filters),
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <LogsToolbar />

        {/* Filter dropdowns + chip strip — owned by ben-filters, rendered here. */}
        <LogsFilters />
        <ActiveFilterChips />

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
              Error Loading Logs
            </h3>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              {error?.message || 'Failed to load system logs'}
            </p>
          </div>
        )}

        {showSkeleton ? (
          <LogSkeleton />
        ) : emptyKind ? (
          <EmptyState
            kind={emptyKind}
            onClearFilters={clearAll}
            onClearSearch={() => setFilters({ search: '' })}
            searchValue={filters.search}
          />
        ) : (
          <>
            {/* Mobile cards */}
            <div className="space-y-3 sm:hidden">
              {logs.map((log) => (
                <LogRow.Mobile key={log.id} log={log} />
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Time
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Related Item
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Duration
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Attempts
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {logs.map((log) => (
                      <LogRow.Desktop key={log.id} log={log} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <LogsPagination
              pagination={pagination}
              onPageChange={(page) => setFilters({ page })}
              onLimitChange={(limit: ValidLimit) => setFilters({ limit })}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminLogsPage() {
  return (
    <Suspense fallback={null}>
      <ToastProvider>
        <AutoRefreshControlProvider>
          <AdminLogsPageContent />
        </AutoRefreshControlProvider>
      </ToastProvider>
    </Suspense>
  );
}
