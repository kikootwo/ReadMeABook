/**
 * Component: User Profile Page
 * Documentation: documentation/frontend/components.md
 */

'use client';

import { useMemo } from 'react';
import { Header } from '@/components/layout/Header';
import { RequestCard } from '@/components/requests/RequestCard';
import { useAuth } from '@/contexts/AuthContext';
import { useRequests } from '@/lib/hooks/useRequests';
import { cn } from '@/lib/utils/cn';

export default function ProfilePage() {
  const { user } = useAuth();
  // Always show only the current user's own requests (even for admins)
  const { requests, isLoading } = useRequests(undefined, 50, true);

  // Calculate statistics
  const stats = useMemo(() => {
    if (!requests.length) {
      return {
        total: 0,
        completed: 0,
        active: 0,
        waiting: 0,
        failed: 0,
        cancelled: 0,
      };
    }

    return {
      total: requests.length,
      completed: requests.filter((r: any) => ['available', 'downloaded'].includes(r.status)).length,
      active: requests.filter((r: any) =>
        ['pending', 'searching', 'downloading', 'processing'].includes(r.status)
      ).length,
      waiting: requests.filter((r: any) =>
        ['awaiting_search', 'awaiting_import'].includes(r.status)
      ).length,
      failed: requests.filter((r: any) => r.status === 'failed').length,
      cancelled: requests.filter((r: any) => r.status === 'cancelled').length,
    };
  }, [requests]);

  // Get active downloads (downloading or processing)
  const activeDownloads = useMemo(() => {
    return requests.filter((r: any) =>
      ['downloading', 'processing'].includes(r.status)
    );
  }, [requests]);

  // Get recent requests (last 5)
  const recentRequests = useMemo(() => {
    return [...requests]
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [requests]);

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
              Please log in to view your profile
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8 max-w-7xl space-y-8">
        {/* User Info Card */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            {/* Avatar */}
            <div className="flex-shrink-0">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.username}
                  className="w-24 h-24 rounded-full"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-blue-600 flex items-center justify-center text-white text-3xl font-bold">
                  {user.username.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* User Details */}
            <div className="flex-1 space-y-2 text-center sm:text-left">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
                {user.username}
              </h1>
              {user.email && (
                <p className="text-gray-600 dark:text-gray-400">
                  {user.email}
                </p>
              )}
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                    user.role === 'admin'
                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                  )}
                >
                  {user.role === 'admin' ? 'Administrator' : 'User'}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-500">
                  Plex ID: {user.plexId}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Statistics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {/* Total Requests */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Total</p>
                <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {isLoading ? '...' : stats.total}
                </p>
              </div>
            </div>
          </div>

          {/* Active Requests */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Active</p>
                <p className="text-xl sm:text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {isLoading ? '...' : stats.active}
                </p>
              </div>
            </div>
          </div>

          {/* Waiting Requests */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Waiting</p>
                <p className="text-xl sm:text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                  {isLoading ? '...' : stats.waiting}
                </p>
              </div>
            </div>
          </div>

          {/* Completed Requests */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Completed</p>
                <p className="text-xl sm:text-2xl font-bold text-green-600 dark:text-green-400">
                  {isLoading ? '...' : stats.completed}
                </p>
              </div>
            </div>
          </div>

          {/* Failed Requests */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-red-100 dark:bg-red-900 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Failed</p>
                <p className="text-xl sm:text-2xl font-bold text-red-600 dark:text-red-400">
                  {isLoading ? '...' : stats.failed}
                </p>
              </div>
            </div>
          </div>

          {/* Cancelled Requests */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">Cancelled</p>
                <p className="text-xl sm:text-2xl font-bold text-gray-600 dark:text-gray-400">
                  {isLoading ? '...' : stats.cancelled}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Active Downloads */}
        {activeDownloads.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                Active Downloads
              </h2>
              <a
                href="/requests"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                View All Requests →
              </a>
            </div>
            <div className="space-y-4">
              {activeDownloads.map((request: any) => (
                <RequestCard key={request.id} request={request} showActions={false} />
              ))}
            </div>
          </div>
        )}

        {/* Recent Requests */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Recent Requests
            </h2>
            <a
              href="/requests"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              View All Requests →
            </a>
          </div>

          {isLoading ? (
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
          ) : recentRequests.length > 0 ? (
            <div className="space-y-4">
              {recentRequests.map((request: any) => (
                <RequestCard key={request.id} request={request} showActions={false} />
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-white dark:bg-gray-800 rounded-lg shadow-md space-y-4">
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
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  No requests yet
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Start by searching for audiobooks and requesting them
                </p>
              </div>
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
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
