/**
 * Component: Indexer Search Failure Notice (interactive search)
 * Documentation: documentation/phase3/prowlarr.md
 *
 * Shown when some or all indexer searches failed, so a failed search never reads as
 * "nothing found" (#522).
 */

'use client';

import React from 'react';
import type { SearchFailureSummary } from '@/lib/utils/indexer-search-failures';

export function searchFailureText({ failed, total }: SearchFailureSummary): string {
  if (failed < total) return `${failed} of ${total} indexer searches failed, so results may be incomplete.`;
  return total === 1
    ? 'The indexer search failed, so no indexer results could be fetched.'
    : `All ${total} indexer searches failed, so no indexer results could be fetched.`;
}

interface SearchFailureNoticeProps {
  failures: SearchFailureSummary;
  /** Shown as "Search again" when there are no results to look at */
  onRetry?: () => void;
}

export function SearchFailureNotice({ failures, onRetry }: SearchFailureNoticeProps) {
  return (
    <div
      role="status"
      data-testid="search-failure-notice"
      className="flex items-start gap-2.5 px-3.5 py-3 bg-amber-50/80 dark:bg-amber-500/10 rounded-xl border border-amber-200/60 dark:border-amber-500/20"
    >
      <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-amber-800 dark:text-amber-300 leading-snug">{searchFailureText(failures)}</p>
        {failures.errors.length > 0 && (
          <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1 leading-snug break-words">
            Error: {failures.errors.join('; ')}
          </p>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
          >
            Search Again
          </button>
        )}
      </div>
    </div>
  );
}
