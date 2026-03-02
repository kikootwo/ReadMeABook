/**
 * Component: LoadMoreBar
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { CheckCircleIcon } from '@heroicons/react/24/outline';

interface LoadMoreBarProps {
  loadedCount: number;
  totalCount?: number;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  itemLabel?: string;
}

export function LoadMoreBar({
  loadedCount,
  totalCount,
  hasMore,
  isLoading,
  onLoadMore,
  itemLabel = 'books',
}: LoadMoreBarProps) {
  if (loadedCount === 0) return null;

  const allLoaded = !hasMore && !isLoading;

  // Count text
  let countText: string;
  if (allLoaded) {
    countText = `All ${loadedCount.toLocaleString()} ${itemLabel} loaded`;
  } else if (totalCount && totalCount > loadedCount) {
    countText = `Showing ${loadedCount.toLocaleString()} of ${totalCount.toLocaleString()} ${itemLabel}`;
  } else {
    countText = `${loadedCount.toLocaleString()} ${itemLabel} loaded`;
  }

  return (
    <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-2xl px-4 sm:px-6 py-3 border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
      <div className="flex items-center justify-between">
        {/* Left: Count */}
        <span className="text-sm text-gray-600 dark:text-gray-400">
          {countText}
        </span>

        {/* Right: Action */}
        {allLoaded ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
            <CheckCircleIcon className="w-4 h-4" />
            Complete
          </span>
        ) : (
          <button
            onClick={onLoadMore}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium
                     text-gray-700 dark:text-gray-300
                     border border-gray-300 dark:border-gray-600 rounded-lg
                     hover:bg-gray-100 dark:hover:bg-gray-700
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Loading...
              </>
            ) : (
              'Load more'
            )}
          </button>
        )}
      </div>
    </div>
  );
}
