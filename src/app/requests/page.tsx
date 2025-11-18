/**
 * Component: Requests Page
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { RequestCard } from '@/components/requests/RequestCard';
import { useRequests } from '@/lib/hooks/useRequests';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils/cn';

type FilterStatus = 'all' | 'active' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export default function RequestsPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<FilterStatus>('all');

  // Always fetch only the current user's requests (even for admins)
  // This ensures "My Requests" truly shows only the user's own requests
  // Admins can see all requests in the admin panel
  const { requests, isLoading } = useRequests(undefined, 50, true);

  // Filter requests client-side based on selected filter
  const filteredRequests = filter === 'all'
    ? requests
    : filter === 'active'
    ? requests.filter((r: any) => ['pending', 'searching', 'downloading', 'processing'].includes(r.status))
    : filter === 'waiting'
    ? requests.filter((r: any) => ['awaiting_search', 'awaiting_import'].includes(r.status))
    : filter === 'completed'
    ? requests.filter((r: any) => ['available', 'downloaded'].includes(r.status))
    : requests.filter((r: any) => r.status === filter);

  const filterOptions: { value: FilterStatus; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'waiting', label: 'Waiting' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  // Redirect to login if not authenticated
  if (!user) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="container mx-auto px-4 py-8 max-w-7xl">
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
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Authentication Required
            </h2>
            <p className="text-gray-600 dark:text-gray-400">
              Please log in to view your audiobook requests
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-6 sm:py-8 max-w-7xl space-y-6 sm:space-y-8">
        {/* Page Header */}
        <div className="space-y-2 sm:space-y-4">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-100">
            My Requests
          </h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
            Track the status of your audiobook requests in real-time
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700 -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex gap-2 sm:gap-4 -mb-px overflow-x-auto scrollbar-hide">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setFilter(option.value)}
                className={cn(
                  'px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  filter === option.value
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300'
                )}
              >
                {option.label}
                {!isLoading && (
                  <span className="ml-2 text-xs">
                    ({option.value === 'all'
                      ? requests.length
                      : option.value === 'active'
                      ? requests.filter((r: any) => ['pending', 'searching', 'downloading', 'processing'].includes(r.status)).length
                      : option.value === 'waiting'
                      ? requests.filter((r: any) => ['awaiting_search', 'awaiting_import'].includes(r.status)).length
                      : option.value === 'completed'
                      ? requests.filter((r: any) => ['available', 'downloaded'].includes(r.status)).length
                      : requests.filter((r: any) => r.status === option.value).length
                    })
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 animate-pulse"
              >
                <div className="flex gap-4">
                  <div className="w-24 h-36 bg-gray-300 dark:bg-gray-700 rounded"></div>
                  <div className="flex-1 space-y-3">
                    <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-3/4"></div>
                    <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-1/2"></div>
                    <div className="h-6 bg-gray-300 dark:bg-gray-700 rounded w-24"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Requests List */}
        {!isLoading && filteredRequests.length > 0 && (
          <div className="space-y-4">
            {filteredRequests.map((request: any) => (
              <RequestCard key={request.id} request={request} showActions={true} />
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && filteredRequests.length === 0 && (
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
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {filter === 'all' ? 'No requests yet' : `No ${filter} requests`}
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                {filter === 'all'
                  ? 'Start by searching for audiobooks and requesting them'
                  : `You don't have any ${filter} requests at the moment`
                }
              </p>
            </div>
            {filter === 'all' && (
              <div className="pt-4">
                <a
                  href="/search"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  Search Audiobooks
                </a>
              </div>
            )}
          </div>
        )}

        {/* Auto-refresh indicator */}
        {!isLoading && filteredRequests.length > 0 && (
          <div className="text-center text-xs text-gray-500 dark:text-gray-500 py-4">
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>Auto-refreshing every 5 seconds</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
