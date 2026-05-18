/**
 * Component: Admin Blocklist Page
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * Thin orchestrator: reads URL via useBlocklistUrlState, owns SWR + optimistic
 * row state, composes sub-components. Mirrors /admin/logs/page.tsx patterns.
 */

'use client';

import { Suspense, useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { ToastProvider } from '@/components/ui/Toast';
import { authenticatedFetcher } from '@/lib/utils/api';
import { useBlocklistUrlState } from './hooks/useBlocklistUrlState';
import {
  BlockedReleaseRow,
  BlocklistData,
  buildBlocklistApiKey,
  computeEmptyState,
  hasActiveFilters,
  hasActiveSearch,
  ValidLimit,
} from './types';
import { BlocklistToolbar } from './components/BlocklistToolbar';
import BlocklistFilters from './components/BlocklistFilters';
import BlocklistActiveFilterChips from './components/BlocklistActiveFilterChips';
import { BlocklistTable } from './components/BlocklistTable';
import { BlocklistPagination } from './components/BlocklistPagination';
import { BlocklistSkeleton } from './components/BlocklistSkeleton';

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
          No blocked releases.
        </p>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          RMAB will add releases here automatically when downloads or imports fail.
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
        No entries match your current filters.
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

function AdminBlocklistContent() {
  const { filters, setFilters, clearAll } = useBlocklistUrlState();
  const key = buildBlocklistApiKey(filters);

  const { data, error, mutate } = useSWR<BlocklistData>(key, authenticatedFetcher, {
    keepPreviousData: true,
  });

  // Optimistic-removal overlay: ids removed by the current session's Unblock
  // clicks. Once SWR returns fresh data, the next-render derivation drops any
  // ids that are no longer present anyway.
  const [optimisticRemoved, setOptimisticRemoved] = useState<Set<string>>(() => new Set());

  // Reconcile optimistic state with server data: any id we removed that is
  // also absent from the new data can be forgotten.
  useEffect(() => {
    if (!data) return;
    setOptimisticRemoved((prev) => {
      if (prev.size === 0) return prev;
      const serverIds = new Set(data.entries.map((e) => e.id));
      const next = new Set<string>();
      for (const id of prev) {
        if (serverIds.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [data]);

  const visibleEntries = useMemo<BlockedReleaseRow[]>(() => {
    if (!data) return [];
    if (optimisticRemoved.size === 0) return data.entries;
    return data.entries.filter((e) => !optimisticRemoved.has(e.id));
  }, [data, optimisticRemoved]);

  const handleUnblocked = (id: string) => {
    setOptimisticRemoved((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const handleUnblockFailed = (entry: BlockedReleaseRow) => {
    // Roll back the optimistic removal. The next SWR cycle will re-fetch.
    setOptimisticRemoved((prev) => {
      if (!prev.has(entry.id)) return prev;
      const next = new Set(prev);
      next.delete(entry.id);
      return next;
    });
  };

  const handleBulkCleared = () => {
    // Drop optimistic state and refresh — bulk delete invalidates row mapping.
    setOptimisticRemoved(new Set());
    mutate();
  };

  const showSkeleton = !data;
  const total = data?.pagination.total ?? 0;
  const pagination = data?.pagination ?? {
    page: filters.page,
    limit: filters.limit,
    total: 0,
    totalPages: 1,
  };

  const emptyKind = computeEmptyState({
    total: visibleEntries.length,
    hasFilters: hasActiveFilters(filters),
    hasSearch: hasActiveSearch(filters),
  });

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <BlocklistToolbar total={total} onCleared={handleBulkCleared} />
        <BlocklistFilters />
        <BlocklistActiveFilterChips />

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
              Error Loading Blocklist
            </h3>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              {error?.message || 'Failed to load blocklist'}
            </p>
          </div>
        )}

        {showSkeleton ? (
          <BlocklistSkeleton />
        ) : emptyKind ? (
          <EmptyState
            kind={emptyKind}
            onClearFilters={clearAll}
            onClearSearch={() => setFilters({ search: '' })}
            searchValue={filters.search}
          />
        ) : (
          <>
            <BlocklistTable
              entries={visibleEntries}
              onUnblocked={handleUnblocked}
              onUnblockFailed={handleUnblockFailed}
            />
            <BlocklistPagination
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

export default function AdminBlocklistPage() {
  return (
    <Suspense fallback={null}>
      <ToastProvider>
        <AdminBlocklistContent />
      </ToastProvider>
    </Suspense>
  );
}
