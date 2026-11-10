/**
 * Component: Library toolbar (search, Filters button below lg, sort, group, view options)
 * Documentation: documentation/features/library-view.md
 */

'use client';

import React from 'react';
import { SectionToolbar } from '@/components/ui/SectionToolbar';
import { MAX_QUERY_LENGTH } from '@/lib/library-view/constants';
import type { LibraryGroupMode, LibrarySortKey } from '@/lib/library-view/types';

export const SORT_LABELS: Record<LibrarySortKey, string> = {
  added: 'Recently added',
  title: 'Title A to Z',
  author: 'Author A to Z',
  year: 'Newest release',
  duration: 'Longest',
  status: 'Status',
};

interface LibraryToolbarProps {
  input: string;
  onInput: (value: string) => void;
  sort: LibrarySortKey;
  onSort: (sort: LibrarySortKey) => void;
  group: LibraryGroupMode;
  onGroup: (group: LibraryGroupMode) => void;
  activeFilterCount: number;
  onOpenFilters: () => void;
  view: React.ComponentProps<typeof SectionToolbar>;
}

const CONTROL =
  'h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100';

export function LibraryToolbar({
  input,
  onInput,
  sort,
  onSort,
  group,
  onGroup,
  activeFilterCount,
  onOpenFilters,
  view,
}: LibraryToolbarProps) {
  const grouped = group === 'author';
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="relative w-full lg:w-auto lg:flex-1 min-w-0">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          value={input}
          onChange={(e) => onInput(e.target.value)}
          maxLength={MAX_QUERY_LENGTH}
          aria-label="Search the library"
          placeholder="Search title, author, narrator or series"
          className={`${CONTROL} w-full pl-9 pr-3 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
        />
      </div>

      <button
        type="button"
        onClick={onOpenFilters}
        className={`${CONTROL} lg:hidden inline-flex items-center gap-2 px-3 font-medium hover:bg-gray-50 dark:hover:bg-gray-700`}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18M6 12h12M10 20h4" />
        </svg>
        Filters
        {activeFilterCount > 0 && (
          <span className="min-w-[1.25rem] px-1.5 rounded-full bg-blue-600 text-white text-xs leading-5 text-center">
            {activeFilterCount}
          </span>
        )}
      </button>

      <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <span className="sr-only sm:not-sr-only">Sort</span>
        <select
          value={grouped ? 'author' : sort}
          onChange={(e) => onSort(e.target.value as LibrarySortKey)}
          disabled={grouped}
          title={grouped ? 'Grouped by author: sorted by author, then title' : undefined}
          className={`${CONTROL} px-2 pr-8 disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          {(Object.keys(SORT_LABELS) as LibrarySortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      <div
        role="group"
        aria-label="Group by"
        className="inline-flex h-10 items-center rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1 text-sm"
      >
        <span className="px-2 text-gray-500 dark:text-gray-400">Group</span>
        {(['none', 'author'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={group === mode}
            onClick={() => onGroup(mode)}
            className={`h-8 px-3 rounded-lg font-medium transition-colors ${
              group === mode
                ? 'bg-blue-600 text-white'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {mode === 'none' ? 'None' : 'Author'}
          </button>
        ))}
      </div>

      <SectionToolbar {...view} />
    </div>
  );
}
