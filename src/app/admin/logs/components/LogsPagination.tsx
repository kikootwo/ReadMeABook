/**
 * Component: LogsPagination
 * Documentation: documentation/admin-dashboard.md
 *
 * Prev/next + jump-to-page + page-size selector + "Page X of Y · N total logs".
 * Keyboard accessible. Each interactive element ≥ 44×44 touch target.
 * Reading the page-size opens registers a pause-on-interact reason.
 */

'use client';

import { useEffect, useState } from 'react';
import { VALID_LIMITS, ValidLimit, LogsPagination as PaginationData } from '../types';
import { useAutoRefreshControl } from '../hooks/useAutoRefreshControl';

interface LogsPaginationProps {
  pagination: PaginationData;
  onPageChange: (next: number) => void;
  onLimitChange: (next: ValidLimit) => void;
}

export function LogsPagination({
  pagination,
  onPageChange,
  onLimitChange,
}: LogsPaginationProps) {
  const { page, limit, total, totalPages } = pagination;
  const [jumpValue, setJumpValue] = useState(String(page));
  const [limitFocused, setLimitFocused] = useState(false);
  const { register, unregister } = useAutoRefreshControl();

  // Keep jump input in sync when page changes from outside.
  useEffect(() => {
    setJumpValue(String(page));
  }, [page]);

  // Pause auto-refresh while the limit dropdown is focused/open.
  useEffect(() => {
    if (limitFocused) register('page-size-dropdown');
    else unregister('page-size-dropdown');
    return () => unregister('page-size-dropdown');
  }, [limitFocused, register, unregister]);

  const submitJump = () => {
    const parsed = Number.parseInt(jumpValue, 10);
    if (!Number.isFinite(parsed)) {
      setJumpValue(String(page));
      return;
    }
    const clamped = Math.min(Math.max(1, parsed), Math.max(1, totalPages));
    if (clamped !== page) onPageChange(clamped);
    setJumpValue(String(clamped));
  };

  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Summary + limit */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm text-gray-600 dark:text-gray-400">
        <span data-testid="logs-pagination-summary">
          Page <span className="font-medium text-gray-900 dark:text-gray-100">{page}</span> of{' '}
          <span className="font-medium text-gray-900 dark:text-gray-100">{Math.max(1, totalPages)}</span>
          {' · '}
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {total.toLocaleString()}
          </span>{' '}
          {total === 1 ? 'log' : 'logs'}
        </span>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">Per page</span>
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value) as ValidLimit)}
            onFocus={() => setLimitFocused(true)}
            onBlur={() => setLimitFocused(false)}
            className="min-h-[44px] px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
            aria-label="Page size"
          >
            {VALID_LIMITS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Nav controls */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous page"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span className="hidden sm:inline">Previous</span>
        </button>

        <label className="flex items-center gap-2">
          <span className="text-sm text-gray-600 dark:text-gray-400 sr-only sm:not-sr-only">
            Go to
          </span>
          <input
            type="number"
            min={1}
            max={Math.max(1, totalPages)}
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            onBlur={submitJump}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitJump();
              }
            }}
            className="min-h-[44px] w-20 px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm text-center"
            aria-label="Jump to page"
          />
        </label>

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
