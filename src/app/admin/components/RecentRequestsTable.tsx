/**
 * Component: Admin Requests Management Table
 * Documentation: documentation/admin-dashboard.md
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import useSWR from 'swr';
import { ConfirmDialog } from './ConfirmDialog';
import { RequestActionsDropdown } from './RequestActionsDropdown';
import { mutate } from 'swr';
import { authenticatedFetcher, fetchWithAuth } from '@/lib/utils/api';
import { useToast } from '@/components/ui/Toast';

interface RecentRequest {
  requestId: string;
  title: string;
  author: string;
  status: string;
  type?: 'audiobook' | 'ebook';
  userId: string;
  user: string;
  createdAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
  torrentUrl?: string | null;
}

interface User {
  id: string;
  plexUsername: string;
}

interface RequestsResponse {
  requests: RecentRequest[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface RecentRequestsTableProps {
  ebookSidecarEnabled?: boolean;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'awaiting_approval', label: 'Awaiting Approval' },
  { value: 'awaiting_search', label: 'Awaiting Search' },
  { value: 'searching', label: 'Searching' },
  { value: 'downloading', label: 'Downloading' },
  { value: 'processing', label: 'Processing' },
  { value: 'downloaded', label: 'Downloaded' },
  { value: 'awaiting_import', label: 'Awaiting Import' },
  { value: 'available', label: 'Available' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'warn', label: 'Warning' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'denied', label: 'Denied' },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

type SortField = 'createdAt' | 'completedAt' | 'title' | 'user' | 'status';
type SortOrder = 'asc' | 'desc';

function getStatusBadge(status: string) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    awaiting_approval: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    awaiting_search: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    searching: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    downloading: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    downloaded: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    processing: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    awaiting_import: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    available: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    warn: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    denied: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  };

  const style = styles[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';

  const labels: Record<string, string> = {
    awaiting_search: 'Awaiting Search',
    awaiting_import: 'Awaiting Import',
    awaiting_approval: 'Awaiting Approval',
  };

  const label = labels[status] || status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${style}`}
    >
      {label}
    </span>
  );
}

function SortIcon({ field, currentSort, currentOrder }: { field: SortField; currentSort: SortField; currentOrder: SortOrder }) {
  if (field !== currentSort) {
    return (
      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }

  return currentOrder === 'asc' ? (
    <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export function RecentRequestsTable({ ebookSidecarEnabled = false }: RecentRequestsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();

  // Get filter state from URL
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '25', 10);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || 'all';
  const userId = searchParams.get('userId') || '';
  const sortBy = (searchParams.get('sortBy') || 'createdAt') as SortField;
  const sortOrder = (searchParams.get('sortOrder') || 'desc') as SortOrder;

  // Local search input state for debouncing
  const [searchInput, setSearchInput] = useState(search);

  // Dialog states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFetchingEbook, setIsFetchingEbook] = useState(false);

  // Build API URL with current filters
  const apiUrl = `/api/admin/requests?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}&status=${status}&userId=${userId}&sortBy=${sortBy}&sortOrder=${sortOrder}`;

  // Fetch requests with SWR
  const { data, error, isLoading } = useSWR<RequestsResponse>(apiUrl, authenticatedFetcher, {
    refreshInterval: 10000,
  });

  // Fetch users for filter dropdown
  const { data: usersData } = useSWR<{ users: User[] }>('/api/admin/users', authenticatedFetcher);

  // Update URL with new params
  const updateParams = useCallback(
    (updates: Record<string, string | number>) => {
      const params = new URLSearchParams(searchParams.toString());

      Object.entries(updates).forEach(([key, value]) => {
        if (value === '' || value === 'all' || (key === 'page' && value === 1) || (key === 'pageSize' && value === 25)) {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      });

      // Reset to page 1 when filters change (except when changing page itself)
      if (!('page' in updates)) {
        params.delete('page');
      }

      const newUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      router.push(newUrl, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) {
        updateParams({ search: searchInput });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, search, updateParams]);

  // Sync search input with URL param on mount
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  const handleSort = (field: SortField) => {
    if (field === sortBy) {
      updateParams({ sortOrder: sortOrder === 'asc' ? 'desc' : 'asc' });
    } else {
      updateParams({ sortBy: field, sortOrder: 'desc' });
    }
  };

  const clearFilters = () => {
    setSearchInput('');
    router.push(pathname, { scroll: false });
  };

  const hasActiveFilters = search || status !== 'all' || userId;

  // Action handlers
  const handleDeleteClick = (requestId: string, title: string) => {
    setSelectedRequest({ id: requestId, title });
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedRequest) return;

    setIsDeleting(true);

    try {
      const response = await fetchWithAuth(`/api/admin/requests/${selectedRequest.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete request');
      }

      // Refresh the requests list
      await mutate(apiUrl);
      await mutate('/api/admin/metrics');
      await mutate((key) => typeof key === 'string' && key.includes('/api/audiobooks'));

      setShowDeleteConfirm(false);
      setSelectedRequest(null);
      toast.success('Request deleted successfully');
    } catch (error) {
      console.error('[Admin] Failed to delete request:', error);
      toast.error(`Failed to delete request: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
    setSelectedRequest(null);
  };

  const handleManualSearch = async (requestId: string) => {
    try {
      const response = await fetchWithAuth(`/api/requests/${requestId}/manual-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to trigger manual search');
      }

      toast.success('Manual search triggered');
      await mutate(apiUrl);
    } catch (error) {
      console.error('[Admin] Failed to trigger manual search:', error);
      toast.error(`Failed to trigger manual search: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCancel = async (requestId: string) => {
    try {
      const response = await fetchWithAuth(`/api/requests/${requestId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'cancel' }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to cancel request');
      }

      toast.success('Request cancelled');
      await mutate(apiUrl);
    } catch (error) {
      console.error('[Admin] Failed to cancel request:', error);
      toast.error(`Failed to cancel request: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleFetchEbook = async (requestId: string) => {
    setIsFetchingEbook(true);
    try {
      const response = await fetchWithAuth(`/api/requests/${requestId}/fetch-ebook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error || responseData.message || 'Failed to fetch e-book');
      }

      if (responseData.success) {
        toast.success(responseData.message || 'E-book fetched successfully');
      } else {
        toast.warning(`E-book fetch failed: ${responseData.message}`);
      }
    } catch (error) {
      console.error('[Admin] Failed to fetch e-book:', error);
      toast.error(`Failed to fetch e-book: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsFetchingEbook(false);
    }
  };

  // Render loading state
  if (isLoading && !data) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8">
        <div className="text-center text-red-600 dark:text-red-400">
          Failed to load requests. Please try again.
        </div>
      </div>
    );
  }

  const requests = data?.requests || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  // Calculate display range
  const startIndex = (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, total);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Filter Bar */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search Input */}
          <div className="flex-1 relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search by title or author..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          </div>

          {/* Status Filter */}
          <select
            value={status}
            onChange={(e) => updateParams({ status: e.target.value })}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm min-w-[160px]"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {/* User Filter */}
          <select
            value={userId}
            onChange={(e) => updateParams({ userId: e.target.value })}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm min-w-[160px]"
          >
            <option value="">All Users</option>
            {usersData?.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.plexUsername}
              </option>
            ))}
          </select>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {requests.length === 0 ? (
        <div className="p-8 text-center">
          <div className="text-gray-400 dark:text-gray-600 mb-2">
            <svg className="w-12 h-12 mx-auto" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path
                fillRule="evenodd"
                d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {hasActiveFilters ? 'No Matching Requests' : 'No Requests'}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {hasActiveFilters
              ? 'Try adjusting your filters or search terms.'
              : 'No audiobook requests have been made yet.'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    onClick={() => handleSort('title')}
                  >
                    <div className="flex items-center gap-2">
                      Request
                      <SortIcon field="title" currentSort={sortBy} currentOrder={sortOrder} />
                    </div>
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    onClick={() => handleSort('user')}
                  >
                    <div className="flex items-center gap-2">
                      User
                      <SortIcon field="user" currentSort={sortBy} currentOrder={sortOrder} />
                    </div>
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center gap-2">
                      Status
                      <SortIcon field="status" currentSort={sortBy} currentOrder={sortOrder} />
                    </div>
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    onClick={() => handleSort('createdAt')}
                  >
                    <div className="flex items-center gap-2">
                      Requested
                      <SortIcon field="createdAt" currentSort={sortBy} currentOrder={sortOrder} />
                    </div>
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    onClick={() => handleSort('completedAt')}
                  >
                    <div className="flex items-center gap-2">
                      Completed
                      <SortIcon field="completedAt" currentSort={sortBy} currentOrder={sortOrder} />
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {requests.map((request) => (
                  <tr
                    key={request.requestId}
                    className="hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {request.title}
                          </span>
                          {request.type === 'ebook' && (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full"
                              style={{ backgroundColor: '#f16f1920', color: '#f16f19' }}
                            >
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                              </svg>
                              Ebook
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {request.author}
                        </div>
                        {request.errorMessage && (request.status === 'failed' || request.status === 'warn') && (
                          <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                            {request.errorMessage}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                      {request.user}
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(request.status)}</td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                      {request.completedAt
                        ? formatDistanceToNow(new Date(request.completedAt), {
                            addSuffix: true,
                          })
                        : '-'}
                    </td>
                    <td className="px-6 py-4">
                      <RequestActionsDropdown
                        request={{
                          requestId: request.requestId,
                          title: request.title,
                          author: request.author,
                          status: request.status,
                          type: request.type,
                          torrentUrl: request.torrentUrl,
                        }}
                        onDelete={handleDeleteClick}
                        onManualSearch={handleManualSearch}
                        onCancel={handleCancel}
                        onFetchEbook={handleFetchEbook}
                        ebookSidecarEnabled={ebookSidecarEnabled}
                        isLoading={isDeleting || isFetchingEbook}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              {/* Results info */}
              <div className="text-sm text-gray-700 dark:text-gray-300">
                Showing <span className="font-medium">{startIndex}</span> to{' '}
                <span className="font-medium">{endIndex}</span> of{' '}
                <span className="font-medium">{total}</span> requests
              </div>

              <div className="flex items-center gap-4">
                {/* Page size selector */}
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-700 dark:text-gray-300">Show:</label>
                  <select
                    value={pageSize}
                    onChange={(e) => updateParams({ pageSize: parseInt(e.target.value, 10) })}
                    className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Page navigation */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateParams({ page: 1 })}
                    disabled={page === 1}
                    className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="First page"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => updateParams({ page: page - 1 })}
                    disabled={page === 1}
                    className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Previous page"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  {/* Page numbers */}
                  <div className="flex items-center gap-1 mx-2">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (page <= 3) {
                        pageNum = i + 1;
                      } else if (page >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = page - 2 + i;
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => updateParams({ page: pageNum })}
                          className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                            page === pageNum
                              ? 'bg-blue-600 text-white'
                              : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => updateParams({ page: page + 1 })}
                    disabled={page === totalPages}
                    className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Next page"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => updateParams({ page: totalPages })}
                    disabled={page === totalPages}
                    className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Last page"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Request?"
        message={
          selectedRequest ? (
            <div>
              <p className="mb-3">
                This will delete the request for &quot;{selectedRequest.title}&quot; and:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                <li>Remove the request (allowing it to be re-requested)</li>
                <li>Delete files from the media directory</li>
                <li>Keep torrent seeding if time remaining</li>
              </ul>
              <p className="mt-3 font-semibold">Are you sure?</p>
            </div>
          ) : (
            ''
          )
        }
        confirmLabel={isDeleting ? 'Deleting...' : 'Delete'}
        cancelLabel="Cancel"
        confirmVariant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  );
}
