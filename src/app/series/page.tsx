/**
 * Component: Series Page
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { SeriesGrid } from '@/components/series/SeriesGrid';
import { useSeriesSearch } from '@/lib/hooks/useSeries';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { CardSizeControls } from '@/components/ui/CardSizeControls';
import { SquareCoversToggle } from '@/components/ui/SquareCoversToggle';
import { usePreferences } from '@/contexts/PreferencesContext';

function SeriesPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get('q') || '';

  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const { cardSize, setCardSize, squareCovers, setSquareCovers } = usePreferences();

  // Debounce search query and sync to URL
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      // Update URL without adding history entries
      const trimmed = query.trim();
      if (trimmed) {
        router.replace(`/series?q=${encodeURIComponent(trimmed)}`, { scroll: false });
      } else {
        router.replace('/series', { scroll: false });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query, router]);

  const { series, isLoading } = useSeriesSearch(debouncedQuery);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
  }, []);

  return (
    <ProtectedRoute>
      <div className="min-h-screen">
        <Header />

        <main className="container mx-auto px-4 py-8 max-w-7xl space-y-8">
          {/* Page Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100">
              Browse Series
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Search for your favorite audiobook series
            </p>
          </div>

          {/* Search Form */}
          <form onSubmit={handleSearch} className="max-w-3xl mx-auto">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg
                  className="h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by series name..."
                className="w-full pl-12 pr-12 py-4 text-lg border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>
          </form>

          {/* Results */}
          {debouncedQuery ? (
            <div className="space-y-6">
              {/* Sticky Results Header */}
              <div className="sticky top-14 sm:top-16 z-30 mb-4 sm:mb-6">
                <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-md rounded-2xl px-4 sm:px-6 py-3 border border-gray-200/50 dark:border-gray-700/50 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-1 h-6 bg-gradient-to-b from-emerald-500 to-teal-500 rounded-full" />
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
                      Series
                    </h2>
                    {!isLoading && series.length > 0 && (
                      <span className="text-sm text-gray-600 dark:text-gray-400 hidden sm:inline whitespace-nowrap">
                        ({series.length} result{series.length !== 1 ? 's' : ''})
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      <SquareCoversToggle enabled={squareCovers} onToggle={setSquareCovers} />
                      <CardSizeControls size={cardSize} onSizeChange={setCardSize} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Series Grid */}
              <SeriesGrid
                series={series}
                isLoading={!!isLoading}
                emptyMessage={`No series found for "${debouncedQuery}"`}
                cardSize={cardSize}
                squareCovers={squareCovers}
              />
            </div>
          ) : (
            /* Empty State */
            <div className="text-center py-16 space-y-4">
              <svg
                className="mx-auto h-16 w-16 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                />
              </svg>
              <p className="text-xl text-gray-600 dark:text-gray-400">
                Start typing to search for series
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                Search by series name to discover audiobook collections
              </p>
            </div>
          )}
        </main>
      </div>
    </ProtectedRoute>
  );
}

export default function SeriesPage() {
  return (
    <Suspense>
      <SeriesPageContent />
    </Suspense>
  );
}
