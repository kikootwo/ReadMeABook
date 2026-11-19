/**
 * Component: Request Card
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React from 'react';
import Image from 'next/image';
import { StatusBadge } from './StatusBadge';
import { RequestCardHeader } from './RequestCardHeader';
import { EbookPill } from './EbookPill';
import { Button } from '@/components/ui/Button';
import { useCancelRequest } from '@/lib/hooks/useRequests';
import { cn } from '@/lib/utils/cn';
import { usePreferences } from '@/contexts/PreferencesContext';
import { AudiobookDetailsModal } from '@/components/audiobooks/AudiobookDetailsModal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { COMPLETED_STATUSES, CANCELLABLE_STATUSES, requestPhase } from '@/lib/constants/request-statuses';
import { cancelConfirmText } from '@/lib/utils/cancel-confirm-text';
import { useAuth } from '@/contexts/AuthContext';
import { useExplicitMarkEnabled } from '@/lib/hooks/useExplicitMark';
import { RequestExplicitControl } from './ExplicitCheckbox';

interface RequestCardProps {
  request: {
    id: string;
    type?: 'audiobook' | 'ebook';
    /** Owner of the request; lets Interactive Search pick for this request instead of creating one */
    userId?: string;
    status: string;
    progress: number;
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    downloadAvailable?: boolean;
    releaseDate?: string | Date | null;
    explicit?: boolean; // #542
    audiobook: {
      id: string;
      audibleAsin?: string;
      libraryAsin?: string | null; // effective library ASIN: the details show that edition (#325)
      title: string;
      author: string;
      narrator?: string | null;
      year?: number | null;
      series?: string | null;
      seriesPart?: string | null;
      description?: string | null;
      coverArtUrl?: string;
      filePath?: string | null;
      fileFormat?: string | null;
    };
  };
  showActions?: boolean;
  /** After a change saved from the card (the Explicit mark): reload the list it came from */
  onChanged?: () => void;
}

export function RequestCard({ request, showActions = true, onChanged }: RequestCardProps) {
  const { cancelRequest, isLoading } = useCancelRequest();
  const { squareCovers } = usePreferences();
  const [showError, setShowError] = React.useState(false);
  const [showDetailsModal, setShowDetailsModal] = React.useState(false);
  const [coverError, setCoverError] = React.useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = React.useState(false);

  const isAwaitingApproval = request.status === 'awaiting_approval';

  const requestType = request.type || 'audiobook';
  const isEbook = requestType === 'ebook';

  const isCompleted = COMPLETED_STATUSES.includes(request.status as typeof COMPLETED_STATUSES[number]);
  const canCancel = (CANCELLABLE_STATUSES as readonly string[]).includes(request.status);
  const isActive = ['searching', 'downloading', 'processing'].includes(request.status);
  const isFailed = request.status === 'failed';
  const { user } = useAuth();
  // Explicit mark (#542): Audiobookshelf with the setting on, audiobook requests, not on denied ones (never delivered)
  const showExplicit = useExplicitMarkEnabled() && !isEbook && request.status !== 'denied';
  // Processing says what it is doing; its bar shows only while chapters merge (#216)
  const phase = requestPhase(request.status, request.progress);
  const barPercent = phase ? phase.percent : isActive && request.progress > 0 ? request.progress : null;
  // Active with no progress yet (no bar): "Setting up..."; with a bar no note, the bar says it
  const isSettingUp = !phase && isActive && request.progress === 0;

  const releaseDateLabel = React.useMemo(() => {
    if (request.status !== 'awaiting_release' || !request.releaseDate) return null;
    const parsed = new Date(request.releaseDate);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }, [request.status, request.releaseDate]);

  const handleConfirmCancel = async () => {
    try {
      await cancelRequest(request.id);
      setConfirmCancelOpen(false);
    } catch (error) {
      console.error('Failed to cancel request:', error);
      setConfirmCancelOpen(false);
    }
  };

  // Follows "Completed" / "Requested", so relative phrases are lowercase
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
      <div className="flex flex-col gap-2 sm:gap-3 px-3 sm:px-4 pt-3 sm:pt-4 pb-3">
        <div className="flex gap-3 sm:gap-4">
          {/* Cover Art */}
          <div className="flex-shrink-0">
            <div
              className={cn(
                'relative rounded overflow-hidden bg-gray-200 dark:bg-gray-700',
                // A square cover is as tall as a 2:3 one (96 / 144 px); the text beside it is sized to that height
                squareCovers
                  ? 'w-24 sm:w-36 aspect-square'
                  : 'w-16 sm:w-24 aspect-[2/3]',
                request.audiobook.audibleAsin && 'cursor-pointer hover:opacity-90 transition-opacity'
              )}
              onClick={() => request.audiobook.audibleAsin && setShowDetailsModal(true)}
              role={request.audiobook.audibleAsin ? 'button' : undefined}
              tabIndex={request.audiobook.audibleAsin ? 0 : undefined}
              onKeyDown={(e) => e.key === 'Enter' && request.audiobook.audibleAsin && setShowDetailsModal(true)}
            >
              {request.audiobook.coverArtUrl && !coverError ? (
                <Image
                  src={request.audiobook.coverArtUrl}
                  alt={request.audiobook.title}
                  fill
                  className="object-cover"
                  sizes={squareCovers ? '144px' : '96px'}
                  onError={() => setCoverError(true)}
                />
              ) : isEbook ? (
                <div className="w-full h-full flex items-center justify-center">
                  <svg
                    className="w-12 h-12"
                    style={{ color: '#f16f19' }}
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z" />
                  </svg>
                </div>
              ) : (
                <Image
                  src="/placeholder_cover.svg"
                  alt={request.audiobook.title}
                  fill
                  className="object-cover"
                  sizes={squareCovers ? '144px' : '96px'}
                />
              )}
            </div>
          </div>

          {/* Request Info */}
          <div className="flex-1 min-w-0">
            {/* Title and pills (status, Ebook) top right; authors, details, release/progress note, description */}
            <RequestCardHeader
              book={request.audiobook}
              badges={
                <>
                  <StatusBadge status={request.status} progress={request.progress} compact />
                  {isEbook && <EbookPill compact />}
                </>
              }
              note={
                releaseDateLabel || phase || isSettingUp ? (
                  <>
                    {releaseDateLabel && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Releases {releaseDateLabel}
                      </span>
                    )}
                    {phase && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <div className="animate-pulse w-2 h-2 bg-blue-500 rounded-full"></div>
                        <span>{phase.label}</span>
                      </div>
                    )}
                    {isSettingUp && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <div className="animate-spin w-3 h-3 border-2 border-gray-300 border-t-blue-500 rounded-full"></div>
                        <span>Setting up...</span>
                      </div>
                    )}
                  </>
                ) : null
              }
            />
          </div>
        </div>

        {/* Progress Bar (downloading/searching; processing only while chapters merge): full width under the cover */}
        {barPercent !== null && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
              <span>Progress</span>
              <span>{barPercent}%</span>
            </div>
            <div
              className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden"
              role="progressbar"
              aria-label="Progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={barPercent}
            >
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-300',
                  request.status === 'downloading' ? 'bg-purple-600' : 'bg-orange-600'
                )}
                style={{ width: `${barPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Error Message: full width under the cover */}
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

        {/* Timestamps and Actions: full width under the cover */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-500 dark:text-gray-500">
            {request.completedAt
              ? `Completed ${formatDate(request.completedAt)}`
              : `Requested ${formatDate(request.createdAt)}`}
          </div>

          {/* Action Buttons */}
          {showActions && (
            // ml-auto + justify-end: right-aligned even when it wraps under the date (a locked Explicit mark is wide)
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {showExplicit && (
                <RequestExplicitControl requestId={request.id} explicit={request.explicit === true} isAdmin={user?.role === 'admin'} onSaved={onChanged} />
              )}
              {canCancel && (
                <Button
                  onClick={() => setConfirmCancelOpen(true)}
                  loading={isLoading}
                  variant="outline"
                  size="sm"
                  className="text-xs sm:text-sm text-red-600 border-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  {isAwaitingApproval ? 'Withdraw' : 'Cancel'}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Audiobook Details Modal */}
      {request.audiobook.audibleAsin && (
        <AudiobookDetailsModal
          asin={request.audiobook.audibleAsin}
          libraryAsin={request.audiobook.libraryAsin}
          isOpen={showDetailsModal}
          onClose={() => setShowDetailsModal(false)}
          onRequestSuccess={onChanged}
          requestStatus={request.status}
          isAvailable={COMPLETED_STATUSES.includes(request.status as typeof COMPLETED_STATUSES[number])}
          requestId={request.id}
          requestedByUserId={request.userId ?? null}
          requestType={requestType}
          requestExplicit={request.explicit === true}
        />
      )}

      <ConfirmModal
        isOpen={confirmCancelOpen}
        onClose={() => !isLoading && setConfirmCancelOpen(false)}
        onConfirm={handleConfirmCancel}
        title={isAwaitingApproval ? 'Withdraw request' : 'Cancel request'}
        message={
          isAwaitingApproval
            ? 'This request is pending admin approval and will be withdrawn. You can request it again later.'
            : cancelConfirmText(request.status, requestType)
        }
        confirmText={isAwaitingApproval ? 'Withdraw request' : 'Cancel request'}
        cancelText="Keep request"
        variant="danger"
        isLoading={isLoading}
      />
    </div>
  );
}
