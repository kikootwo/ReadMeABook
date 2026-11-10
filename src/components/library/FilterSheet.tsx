/**
 * Component: Library filter sheet (below lg: side panel from sm, bottom sheet on phones)
 * Documentation: documentation/features/library-view.md
 */

'use client';

import React from 'react';
import { LibraryDialog } from './LibraryDialog';
import { FacetList } from './FacetList';

interface FilterSheetProps extends React.ComponentProps<typeof FacetList> {
  open: boolean;
  onClose: () => void;
  matched: number;
  onClearAll: () => void;
}

export function FilterSheet({ open, onClose, matched, onClearAll, ...facetProps }: FilterSheetProps) {
  return (
    <LibraryDialog open={open} onClose={onClose} labelledBy="library-filters-title" variant="side">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200/60 dark:border-gray-700/60">
        <h2 id="library-filters-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Filters
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          className="p-2 -mr-2 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        <FacetList {...facetProps} />
      </div>
      <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-200/60 dark:border-gray-700/60">
        <button
          type="button"
          onClick={onClearAll}
          className="px-4 h-10 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          Clear all
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
        >
          Show {matched.toLocaleString()} {matched === 1 ? 'book' : 'books'}
        </button>
      </div>
    </LibraryDialog>
  );
}
