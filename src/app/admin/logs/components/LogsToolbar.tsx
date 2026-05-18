/**
 * Component: LogsToolbar
 * Documentation: documentation/admin-dashboard.md
 *
 * Sticky header. Three rows on mobile, condensed to two on sm+:
 *   1. Title + description (left), Back-to-dashboard (right)
 *   2. Errors-only pill, Live indicator, Refresh now, Auto-refresh toggle
 *   3. Search input (always visible on mobile, debounced 300ms via the URL hook)
 *
 * Chips (ben-filters) and filter dropdowns (ben-filters) render OUTSIDE this
 * toolbar (in page.tsx) so they scroll away on mobile per Zach resolution #6.
 */

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLogsUrlState } from '../hooks/useLogsUrlState';
import { useAutoRefreshControl } from '../hooks/useAutoRefreshControl';

function formatRelativeSeconds(ts: number, now: number): string {
  if (ts === 0) return '—';
  const elapsedMs = Math.max(0, now - ts);
  const s = Math.floor(elapsedMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function LogsToolbar() {
  const { filters, setFilters, searchInput, setSearchInput, removeFilter } =
    useLogsUrlState();
  const {
    isPaused,
    isRunning,
    pauseReasons,
    enabled,
    setEnabled,
    manualRefresh,
    lastUpdatedAt,
    register,
    unregister,
  } = useAutoRefreshControl();
  const [searchFocused, setSearchFocused] = useState(false);

  useEffect(() => {
    if (searchFocused) register('search-input');
    else unregister('search-input');
    return () => unregister('search-input');
  }, [searchFocused, register, unregister]);

  // Tick once a second so "updated Xs ago" stays fresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const errorsOnlyActive = filters.hasError;
  const indicatorText = isPaused
    ? 'Paused'
    : `Live · updated ${formatRelativeSeconds(lastUpdatedAt, now)}`;
  const indicatorTitle = isPaused
    ? pauseReasons.length > 0
      ? `Paused: ${pauseReasons.join(', ')}`
      : 'Paused'
    : `Auto-refreshing every 10s${
        lastUpdatedAt
          ? ` · last update ${new Date(lastUpdatedAt).toLocaleTimeString()}`
          : ''
      }`;

  return (
    <div className="sticky top-0 z-10 mb-6 sm:mb-8 bg-gray-50 dark:bg-gray-900 py-4 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 border-b border-gray-200 dark:border-gray-800">
      {/* Row 1: title + back link */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
            System Logs
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            View background jobs and system activity
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors text-sm font-medium self-start sm:self-auto flex-shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          <span>Back to Dashboard</span>
        </Link>
      </div>

      {/* Row 2: errors-only pill + live indicator + refresh + auto-toggle */}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button
          type="button"
          onClick={() => {
            if (errorsOnlyActive) removeFilter('hasError');
            else setFilters({ hasError: true });
          }}
          aria-pressed={errorsOnlyActive}
          className={`inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-full text-sm font-medium transition-colors ${
            errorsOnlyActive
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          Errors only
        </button>

        <div
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3 py-2 rounded-full text-sm font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
          title={indicatorTitle}
          aria-label={indicatorTitle}
          data-testid="logs-live-indicator"
          data-state={isPaused ? 'paused' : 'running'}
        >
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              isRunning ? 'bg-green-500 animate-pulse' : 'bg-amber-500'
            }`}
          />
          <span className="text-gray-700 dark:text-gray-300">{indicatorText}</span>
        </div>

        <button
          type="button"
          onClick={manualRefresh}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          aria-label="Refresh now"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          <span className="hidden sm:inline">Refresh now</span>
          <span className="sm:hidden">Refresh</span>
        </button>

        <label className="inline-flex items-center gap-2 ml-auto cursor-pointer">
          <span className="text-sm text-gray-600 dark:text-gray-400">Auto-refresh</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Auto-refresh"
            onClick={() => setEnabled(!enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </label>
      </div>

      {/* Row 3: search input */}
      <div className="mt-3 relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </span>
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="Search by job ID, error, event, book, or user…"
          aria-label="Search logs"
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
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
