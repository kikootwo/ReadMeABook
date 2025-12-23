/**
 * Component: Admin Recent Requests Table
 * Documentation: documentation/admin-dashboard.md
 */

'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ConfirmDialog } from './ConfirmDialog';
import { RequestActionsDropdown } from './RequestActionsDropdown';
import { mutate } from 'swr';
import { fetchWithAuth } from '@/lib/utils/api';

interface RecentRequest {
  requestId: string;
  title: string;
  author: string;
  status: string;
  user: string;
  createdAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
}

interface RecentRequestsTableProps {
  requests: RecentRequest[];
}

function getStatusBadge(status: string) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
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
  };

  const style = styles[status] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';

  const labels: Record<string, string> = {
    awaiting_search: 'Awaiting Search',
    awaiting_import: 'Awaiting Import',
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

export function RecentRequestsTable({ requests }: RecentRequestsTableProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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

      const result = await response.json();

      // Show success message
      console.log('[Admin] Request deleted:', result);

      // Refresh the requests list
      await mutate('/api/admin/requests/recent');
      await mutate('/api/admin/metrics');

      // Close dialog
      setShowDeleteConfirm(false);
      setSelectedRequest(null);
    } catch (error) {
      console.error('[Admin] Failed to delete request:', error);
      alert(
        `Failed to delete request: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
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

      console.log('[Admin] Manual search triggered for request:', requestId);
      // Refresh the requests list
      await mutate('/api/admin/requests/recent');
    } catch (error) {
      console.error('[Admin] Failed to trigger manual search:', error);
      alert(
        `Failed to trigger manual search: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
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

      console.log('[Admin] Request cancelled:', requestId);
      // Refresh the requests list
      await mutate('/api/admin/requests/recent');
    } catch (error) {
      console.error('[Admin] Failed to cancel request:', error);
      alert(
        `Failed to cancel request: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  };

  if (requests.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-8">
        <div className="text-center">
          <div className="text-gray-400 dark:text-gray-600 mb-2">
            <svg
              className="w-12 h-12 mx-auto"
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
          </div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
            No Recent Requests
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            No audiobook requests have been made yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Audiobook
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Requested
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Completed
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
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {request.title}
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
                    }}
                    onDelete={handleDeleteClick}
                    onManualSearch={handleManualSearch}
                    onCancel={handleCancel}
                    isLoading={isDeleting}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
