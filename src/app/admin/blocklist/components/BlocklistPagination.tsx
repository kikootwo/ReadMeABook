/**
 * Component: BlocklistPagination
 * Documentation: documentation/admin-features/release-blocklist.md
 *
 * Prev/next + jump-to-page + page-size selector + "Page X of Y · N total".
 * Keyboard accessible. Each interactive element ≥ 44×44 touch target.
 *
 * Not reusing LogsPagination because that file is wired into the logs page's
 * auto-refresh pause registry (useAutoRefreshControl). The blocklist page has
 * no auto-refresh, so importing the logs version would force adding a
 * provider for plumbing the blocklist page doesn't need.
 */

'use client';

import { useEffect, useState } from 'react';
import { VALID_LIMITS, ValidLimit, BlocklistPagination as PaginationData } from '../types';

interface BlocklistPaginationProps {
  pagination: PaginationData;
  onPageChange: (next: number) => void;
  onLimitChange: (next: ValidLimit) => void;
}

export function BlocklistPagination({
  pagination,
  onPageChange,
  onLimitChange,
}: BlocklistPaginationProps) {
  const { page, limit, total, totalPages } = pagination;
  const [jumpValue, setJumpValue] = useState(String(page));

  useEffect(() => {
    setJumpValue(String(page));
  }, [page]);

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
      <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm text-gray-600 dark:text-gray-400">
        <span data-testid="blocklist-pagination-summary">
          Page <span className="font-medium text-gray-900 dark:text-gray-100">{page}</span> of{' '}
          <span className="font-medium text-gray-900 dark:text-gray-100">{Math.max(1, totalPages)}</span>
          {' · '}
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {total.toLocaleString()}
          </span>{' '}
          {total === 1 ? 'entry' : 'entries'}
        </span>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">Per page</span>
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value) as ValidLimit)}
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

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous page"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}
