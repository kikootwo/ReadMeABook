/**
 * Component: Admin Dashboard Page
 * Documentation: documentation/admin-dashboard.md
 */

'use client';

import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import { authenticatedFetcher, fetchJSON } from '@/lib/utils/api';
import { MetricCard } from './components/MetricCard';
import { ActiveDownloadsTable } from './components/ActiveDownloadsTable';
import { RecentRequestsTable } from './components/RecentRequestsTable';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { formatDistanceToNow } from 'date-fns';
import { useState, Suspense } from 'react';

interface PendingApprovalRequest {
  id: string;
  createdAt: string;
  audiobook: {
    title: string;
    author: string;
    coverArtUrl: string | null;
  };
  user: {
    id: string;
    plexUsername: string;
    avatarUrl: string | null;
  };
}

function PendingApprovalSection({ requests }: { requests: PendingApprovalRequest[] }) {
  const toast = useToast();
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});

  const handleApproveRequest = async (requestId: string) => {
    setLoadingStates((prev) => ({ ...prev, [requestId]: true }));

    try {
      await fetchJSON(`/api/admin/requests/${requestId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ action: 'approve' }),
      });

      toast.success('Request approved');

      // Mutate both pending requests and recent requests caches
      await mutate('/api/admin/requests/pending-approval');
      await mutate('/api/admin/requests/recent');
      await mutate('/api/admin/metrics');
    } catch (error) {
      console.error('[Admin] Failed to approve request:', error);
      toast.error(
        `Failed to approve request: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setLoadingStates((prev) => ({ ...prev, [requestId]: false }));
    }
  };

  const handleDenyRequest = async (requestId: string) => {
    setLoadingStates((prev) => ({ ...prev, [requestId]: true }));

    try {
      await fetchJSON(`/api/admin/requests/${requestId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ action: 'deny' }),
      });

      toast.success('Request denied');

      // Mutate pending requests cache
      await mutate('/api/admin/requests/pending-approval');
      await mutate('/api/admin/metrics');
    } catch (error) {
      console.error('[Admin] Failed to deny request:', error);
      toast.error(
        `Failed to deny request: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setLoadingStates((prev) => ({ ...prev, [requestId]: false }));
    }
  };

  return (
    <div className="mb-8">
      {/* Section Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <svg
            className="w-6 h-6 text-amber-600 dark:text-amber-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            Requests Awaiting Approval
          </h2>
        </div>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
          {requests.length}
        </span>
      </div>

      {/* Requests Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {requests.map((request) => {
          const isLoading = loadingStates[request.id] || false;

          return (
            <div
              key={request.id}
              className="bg-white dark:bg-gray-800 border-2 border-amber-200 dark:border-amber-800 rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden"
            >
              {/* Card Content */}
              <div className="p-4">
                <div className="flex gap-3">
                  {/* Cover Image */}
                  <div className="flex-shrink-0">
                    {request.audiobook.coverArtUrl ? (
                      <img
                        src={request.audiobook.coverArtUrl}
                        alt={request.audiobook.title}
                        className="w-16 h-16 rounded object-cover"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                        <svg
                          className="w-8 h-8 text-gray-400 dark:text-gray-600"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {/* Book Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                      {request.audiobook.title}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                      {request.audiobook.author}
                    </p>

                    {/* User Info */}
                    <div className="flex items-center gap-2 mt-2">
                      {request.user.avatarUrl ? (
                        <img
                          src={request.user.avatarUrl}
                          alt={request.user.plexUsername}
                          className="w-5 h-5 rounded-full"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                          <svg
                            className="w-3 h-3 text-gray-600 dark:text-gray-400"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      )}
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        {request.user.plexUsername}
                      </span>
                    </div>

                    {/* Timestamp */}
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="border-t border-amber-200 dark:border-amber-800 bg-gray-50 dark:bg-gray-900/50 px-4 py-3 flex gap-2">
                <button
                  onClick={() => handleApproveRequest(request.id)}
                  disabled={isLoading}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {isLoading ? (
                    <svg
                      className="animate-spin h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                  <span>Approve</span>
                </button>

                <button
                  onClick={() => handleDenyRequest(request.id)}
                  disabled={isLoading}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {isLoading ? (
                    <svg
                      className="animate-spin h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  )}
                  <span>Deny</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdminDashboardContent() {
  // Fetch data with auto-refresh every 10 seconds
  const { data: metrics, error: metricsError } = useSWR(
    '/api/admin/metrics',
    authenticatedFetcher,
    {
      refreshInterval: 10000,
    }
  );

  const { data: downloadsData, error: downloadsError } = useSWR(
    '/api/admin/downloads/active',
    authenticatedFetcher,
    {
      refreshInterval: 5000, // Refresh downloads more frequently
    }
  );

  // Note: RecentRequestsTable now fetches its own data with filtering/pagination

  const { data: pendingApprovalData } = useSWR(
    '/api/admin/requests/pending-approval',
    authenticatedFetcher,
    {
      refreshInterval: 10000,
    }
  );

  const { data: settingsData } = useSWR(
    '/api/admin/settings',
    authenticatedFetcher,
    {
      refreshInterval: 60000, // Settings change infrequently
    }
  );

  const isLoading = !metrics || !downloadsData;
  const hasError = metricsError || downloadsError;

  if (hasError) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
              Error Loading Dashboard
            </h3>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              {metricsError?.message ||
                downloadsError?.message ||
                'Failed to load dashboard data'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="sticky top-0 z-10 mb-8 flex items-center justify-between bg-gray-50 dark:bg-gray-900 py-4 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Admin Dashboard
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Monitor system health, active downloads, and recent requests
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className="hidden sm:inline">Back to Home</span>
            <span className="sm:hidden">Home</span>
          </Link>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
            {/* Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              <MetricCard
                title="Total Requests"
                value={metrics.totalRequests}
                icon={
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                  </svg>
                }
                variant="default"
              />

              <MetricCard
                title="Active Downloads"
                value={metrics.activeDownloads}
                icon={
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                }
                variant={metrics.activeDownloads > 0 ? 'info' : 'default'}
              />

              <MetricCard
                title="Completed (30d)"
                value={metrics.completedLast30Days}
                icon={
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                }
                variant="success"
              />

              <MetricCard
                title="Failed (30d)"
                value={metrics.failedLast30Days}
                icon={
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                }
                variant={metrics.failedLast30Days > 0 ? 'error' : 'default'}
              />

              <MetricCard
                title="Total Users"
                value={metrics.totalUsers}
                icon={
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                  </svg>
                }
                variant="default"
              />

              <MetricCard
                title="System Health"
                value={metrics.systemHealth.status.toUpperCase()}
                icon={
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                }
                variant={
                  metrics.systemHealth.status === 'healthy'
                    ? 'success'
                    : metrics.systemHealth.status === 'degraded'
                    ? 'warning'
                    : 'error'
                }
                subtitle={
                  metrics.systemHealth.issues.length > 0
                    ? metrics.systemHealth.issues.join(', ')
                    : 'All systems operational'
                }
              />
            </div>

            {/* Requests Awaiting Approval */}
            {pendingApprovalData?.requests && pendingApprovalData.requests.length > 0 && (
              <PendingApprovalSection requests={pendingApprovalData.requests} />
            )}

            {/* Active Downloads */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                Active Downloads
              </h2>
              <ActiveDownloadsTable downloads={downloadsData.downloads} />
            </div>

            {/* Request Management */}
            <div className="mb-8">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                Request Management
              </h2>
              <Suspense
                fallback={
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8">
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                  </div>
                }
              >
                <RecentRequestsTable
                  ebookSidecarEnabled={settingsData?.ebook?.annasArchiveEnabled || settingsData?.ebook?.indexerSearchEnabled || false}
                />
              </Suspense>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Link
                href="/admin/settings"
                className="block p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3">
                  <svg
                    className="w-6 h-6 text-gray-600 dark:text-gray-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    Settings
                  </span>
                </div>
              </Link>

              <Link
                href="/admin/users"
                className="block p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3">
                  <svg
                    className="w-6 h-6 text-gray-600 dark:text-gray-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                  </svg>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    Users
                  </span>
                </div>
              </Link>

              <Link
                href="/admin/jobs"
                className="block p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3">
                  <svg
                    className="w-6 h-6 text-gray-600 dark:text-gray-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    Scheduled Jobs
                  </span>
                </div>
              </Link>

              <Link
                href="/admin/logs"
                className="block p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md transition-all"
              >
                <div className="flex items-center gap-3">
                  <svg
                    className="w-6 h-6 text-gray-600 dark:text-gray-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                    <path
                      fillRule="evenodd"
                      d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    System Logs
                  </span>
                </div>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  return (
    <ToastProvider>
      <AdminDashboardContent />
    </ToastProvider>
  );
}
