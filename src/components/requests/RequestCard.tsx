/**
 * Component: Request Card
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React from 'react';
import Image from 'next/image';
import { StatusBadge } from './StatusBadge';
import { Button } from '@/components/ui/Button';
import { useCancelRequest, useManualSearch } from '@/lib/hooks/useRequests';
import { cn } from '@/lib/utils/cn';
import { InteractiveTorrentSearchModal } from './InteractiveTorrentSearchModal';

interface RequestCardProps {
  request: {
    id: string;
    status: string;
    progress: number;
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    audiobook: {
      id: string;
      title: string;
      author: string;
      coverArtUrl?: string;
    };
  };
  showActions?: boolean;
}

export function RequestCard({ request, showActions = true }: RequestCardProps) {
  const { cancelRequest, isLoading } = useCancelRequest();
  const { triggerManualSearch, isLoading: isManualSearching } = useManualSearch();
  const [showError, setShowError] = React.useState(false);
  const [showInteractiveSearch, setShowInteractiveSearch] = React.useState(false);

  const canCancel = ['pending', 'searching', 'downloading'].includes(request.status);
  const isActive = ['searching', 'downloading', 'processing'].includes(request.status);
  const isFailed = request.status === 'failed';
  const canSearch = ['pending', 'failed', 'awaiting_search'].includes(request.status);

  const handleCancel = async () => {
    if (window.confirm('Are you sure you want to cancel this request?')) {
      try {
        await cancelRequest(request.id);
      } catch (error) {
        console.error('Failed to cancel request:', error);
      }
    }
  };

  const handleManualSearch = async () => {
    try {
      await triggerManualSearch(request.id);
      // Request list will auto-refresh via SWR
    } catch (error) {
      console.error('Failed to trigger manual search:', error);
      alert(error instanceof Error ? error.message : 'Failed to trigger manual search');
    }
  };

  const handleInteractiveSearch = () => {
    setShowInteractiveSearch(true);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
      <div className="flex gap-3 sm:gap-4 p-3 sm:p-4">
        {/* Cover Art */}
        <div className="flex-shrink-0">
          <div className="relative w-16 h-24 sm:w-24 sm:h-36 rounded overflow-hidden bg-gray-200 dark:bg-gray-700">
            {request.audiobook.coverArtUrl ? (
              <Image
                src={request.audiobook.coverArtUrl}
                alt={request.audiobook.title}
                fill
                className="object-cover"
                sizes="96px"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg
                  className="w-12 h-12 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                  />
                </svg>
              </div>
            )}
          </div>
        </div>

        {/* Request Info */}
        <div className="flex-1 min-w-0 space-y-1.5 sm:space-y-2">
          {/* Title and Author */}
          <div>
            <h3 className="text-sm sm:text-base md:text-lg font-semibold text-gray-900 dark:text-gray-100 line-clamp-2">
              {request.audiobook.title}
            </h3>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 truncate">
              By {request.audiobook.author}
            </p>
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2">
            <StatusBadge status={request.status} progress={request.progress} />
            {isActive && request.progress > 0 && (
              <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <div className="animate-pulse w-2 h-2 bg-blue-500 rounded-full"></div>
                <span>Active</span>
              </div>
            )}
            {isActive && request.progress === 0 && (
              <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                <div className="animate-spin w-3 h-3 border-2 border-gray-300 border-t-blue-500 rounded-full"></div>
                <span>Setting up...</span>
              </div>
            )}
          </div>

          {/* Progress Bar (for downloading/processing) */}
          {isActive && request.progress > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
                <span>Progress</span>
                <span>{request.progress}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-300',
                    request.status === 'downloading' ? 'bg-purple-600' : 'bg-orange-600'
                  )}
                  style={{ width: `${request.progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error Message */}
          {isFailed && request.errorMessage && (
            <div className="space-y-1">
              <button
                onClick={() => setShowError(!showError)}
                className="text-xs text-red-600 dark:text-red-400 hover:underline flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={showError ? 'M19 9l-7 7-7-7' : 'M9 5l7 7-7 7'}
                  />
                </svg>
                {showError ? 'Hide error' : 'Show error'}
              </button>
              {showError && (
                <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                  {request.errorMessage}
                </div>
              )}
            </div>
          )}

          {/* Timestamps and Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="text-xs text-gray-500 dark:text-gray-500">
              {request.completedAt
                ? `Completed ${formatDate(request.completedAt)}`
                : `Requested ${formatDate(request.createdAt)}`}
            </div>

            {/* Action Buttons */}
            {showActions && (
              <div className="flex flex-wrap gap-2">
                {canSearch && (
                  <>
                    <Button
                      onClick={handleManualSearch}
                      loading={isManualSearching}
                      variant="outline"
                      size="sm"
                      className="text-xs sm:text-sm"
                    >
                      Manual Search
                    </Button>
                    <Button
                      onClick={handleInteractiveSearch}
                      variant="primary"
                      size="sm"
                      className="text-xs sm:text-sm"
                    >
                      Interactive Search
                    </Button>
                  </>
                )}
                {canCancel && (
                  <Button
                    onClick={handleCancel}
                    loading={isLoading}
                    variant="outline"
                    size="sm"
                    className="text-xs sm:text-sm text-red-600 border-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    Cancel
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Interactive Search Modal */}
      <InteractiveTorrentSearchModal
        isOpen={showInteractiveSearch}
        onClose={() => setShowInteractiveSearch(false)}
        requestId={request.id}
        audiobook={{
          title: request.audiobook.title,
          author: request.audiobook.author,
        }}
      />
    </div>
  );
}
