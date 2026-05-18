/**
 * Component: BlocklistToolbar
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * Sticky header with title, back-to-dashboard link, search input, and a
 * "Clear filtered (N)" affordance that opens the typed-token confirm modal.
 *
 * The "Clear filtered" button is intentionally visible AND distinct (red-tinted)
 * per zach.md UX rule: "UI affordances must be visibly intentional. First-time
 * user should grok what's tappable from the design."
 */

'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useBlocklistUrlState } from '../hooks/useBlocklistUrlState';
import {
  BlocklistFilterState,
  buildBulkClearQueryString,
  hasActiveFilters,
  hasActiveSearch,
} from '../types';
import { ClearFilteredConfirmModal } from './ClearFilteredConfirmModal';

interface BlocklistToolbarProps {
  /** Total rows matching current filters (drives "Clear filtered (N)" label). */
  total: number;
  /** Called after successful bulk clear so the page can refresh data. */
  onCleared: () => void;
}

export function BlocklistToolbar({ total, onCleared }: BlocklistToolbarProps) {
  const { filters, searchInput, setSearchInput, removeFilter } = useBlocklistUrlState();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const filtersActive = hasActiveFilters(filters) || hasActiveSearch(filters);
  const canClear = total > 0;

  return (
    <div className="sticky top-0 z-10 mb-6 sm:mb-8 bg-gray-50 dark:bg-gray-900 py-4 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 border-b border-gray-200 dark:border-gray-800">
      {/* Row 1: title + back link */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
            Release Blocklist
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Releases auto-blocked from download or organize failures. Unblock to allow re-grabbing.
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors text-sm font-medium self-start sm:self-auto flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span>Back to Dashboard</span>
        </Link>
      </div>

      {/* Row 2: "Clear filtered (N)" button — only when something would be cleared */}
      {canClear && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40 transition-colors"
            aria-label={
              filtersActive
                ? `Clear ${total} filtered blocklist entries`
                : `Clear all ${total} blocklist entries`
            }
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {filtersActive ? `Clear filtered (${total.toLocaleString()})` : `Clear all (${total.toLocaleString()})`}
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {filtersActive
              ? 'Unblocks every entry matching the current filters.'
              : 'Unblocks every entry. Apply a filter first to scope.'}
          </span>
        </div>
      )}

      {/* Row 3: search input */}
      <div className="mt-3 relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </span>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search release name or reason…"
          aria-label="Search blocklist"
          className="w-full min-h-[44px] pl-9 pr-10 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              removeFilter('search');
            }}
            aria-label="Clear search"
            className="absolute inset-y-0 right-2 my-auto inline-flex items-center justify-center w-8 h-8 rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <ClearFilteredConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onCleared={onCleared}
        total={total}
        filtersActive={filtersActive}
        queryString={buildBulkClearQueryString(filters as BlocklistFilterState)}
      />
    </div>
  );
}
