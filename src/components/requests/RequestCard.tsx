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
import { usePreferences } from '@/contexts/PreferencesContext';
import { useAuth } from '@/contexts/AuthContext';
import { InteractiveTorrentSearchModal } from './InteractiveTorrentSearchModal';
import { AudiobookDetailsModal } from '@/components/audiobooks/AudiobookDetailsModal';

interface RequestCardProps {
  request: {
    id: string;
    type?: 'audiobook' | 'ebook';
    status: string;
    progress: number;
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    downloadUrl?: string | null;
    audiobook: {
      id: string;
      audibleAsin?: string;
      title: string;
      author: string;
      coverArtUrl?: string;
      filePath?: string | null;
      fileFormat?: string | null;
    };
  };
  showActions?: boolean;
}

export function RequestCard({ request, showActions = true }: RequestCardProps) {
  const { cancelRequest, isLoading } = useCancelRequest();
  const { triggerManualSearch, isLoading: isManualSearching } = useManualSearch();
  const { squareCovers } = usePreferences();
  const { user } = useAuth();
  const [showError, setShowError] = React.useState(false);
  const [showInteractiveSearch, setShowInteractiveSearch] = React.useState(false);
  const [showDetailsModal, setShowDetailsModal] = React.useState(false);

  const requestType = request.type || 'audiobook';
  const isEbook = requestType === 'ebook';

  const isCompleted = ['available', 'downloaded'].includes(request.status);
  const canCancel = ['pending', 'searching', 'downloading'].includes(request.status);
  const isActive = ['searching', 'downloading', 'processing'].includes(request.status);
  const isFailed = request.status === 'failed';
  // Ebook requests don't support interactive search (Anna's Archive only)
  // Interactive search also requires the interactiveSearch permission
  const hasInteractiveSearchAccess = user?.role === 'admin' || user?.permissions?.interactiveSearch !== false;
  const canSearch = hasInteractiveSearchAccess && !isEbook && ['pending', 'failed', 'awaiting_search'].includes(request.status);

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
          <div
            className={cn(
              'relative rounded overflow-hidden bg-gray-200 dark:bg-gray-700',
              squareCovers
                ? 'w-16 sm:w-24 aspect-square'
                : 'w-16 sm:w-24 aspect-[2/3]',
              request.audiobook.audibleAsin && 'cursor-pointer hover:opacity-90 transition-opacity'
            )}
            onClick={() => request.audiobook.audibleAsin && setShowDetailsModal(true)}
            role={request.audiobook.audibleAsin ? 'button' : undefined}
            tabIndex={request.audiobook.audibleAsin ? 0 : undefined}
            onKeyDown={(e) => e.key === 'Enter' && request.audiobook.audibleAsin && setShowDetailsModal(true)}
          >
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
                {isEbook ? (
                  <svg
                    className="w-12 h-12"
                    style={{ color: '#f16f19' }}
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z" />
                  </svg>
                ) : (
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
                )}
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

          {/* Status Badge and Type Badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={request.status} progress={request.progress} />
            {isEbook && (
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
                {isCompleted && request.downloadUrl && (
                  <a
                    href={request.downloadUrl}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                  </a>
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

      {/* Audiobook Details Modal */}
      {request.audiobook.audibleAsin && (
        <AudiobookDetailsModal
          asin={request.audiobook.audibleAsin}
          isOpen={showDetailsModal}
          onClose={() => setShowDetailsModal(false)}
          requestStatus={request.status}
          isAvailable={['available', 'downloaded'].includes(request.status)}
          hideRequestActions
        />
      )}
    </div>
  );
}
