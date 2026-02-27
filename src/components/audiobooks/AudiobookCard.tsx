/**
 * Component: Audiobook Card
 * Documentation: documentation/frontend/components.md
 *
 * Premium "Cover First" design - Apple-inspired aesthetic
 * The cover is the hero. Metadata supports, never overwhelms.
 */

'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { AudiobookDetailsModal } from '@/components/audiobooks/AudiobookDetailsModal';
import { useCreateRequest } from '@/lib/hooks/useRequests';
import { useAuth } from '@/contexts/AuthContext';
import { Audiobook } from '@/lib/hooks/useAudiobooks';

interface AudiobookCardProps {
  audiobook: Audiobook;
  isRequested?: boolean;
  requestStatus?: string;
  onRequestSuccess?: () => void;
  squareCovers?: boolean;
}

// Status configuration for elegant display
const getStatusConfig = (audiobook: Audiobook) => {
  if (audiobook.isAvailable || audiobook.requestStatus === 'completed') {
    return { type: 'available', label: 'In Library', color: 'emerald' };
  }

  const processingStatuses = ['downloading', 'processing', 'downloaded', 'awaiting_import'];
  if (audiobook.requestStatus && processingStatuses.includes(audiobook.requestStatus)) {
    return { type: 'processing', label: 'Processing', color: 'amber' };
  }

  const pendingStatuses = ['pending', 'awaiting_search', 'searching', 'awaiting_approval'];
  if (audiobook.requestStatus && pendingStatuses.includes(audiobook.requestStatus)) {
    return { type: 'pending', label: 'Requested', color: 'blue' };
  }

  if (audiobook.requestStatus === 'denied') {
    return { type: 'denied', label: 'Denied', color: 'red' };
  }

  return null;
};

export function AudiobookCard({
  audiobook,
  onRequestSuccess,
  squareCovers = false,
}: AudiobookCardProps) {
  const { user } = useAuth();
  const { createRequest, isLoading } = useCreateRequest();
  const [showToast, setShowToast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [localRequestStatus, setLocalRequestStatus] = useState<string | undefined>(undefined);

  // Build a display-only audiobook with the local status override
  const displayAudiobook = localRequestStatus !== undefined
    ? { ...audiobook, requestStatus: localRequestStatus }
    : audiobook;
  const status = getStatusConfig(displayAudiobook);

  const handleRequest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      setError('Please log in to request audiobooks');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      await createRequest(audiobook);
      setLocalRequestStatus('pending');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2500);
      onRequestSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create request');
      setTimeout(() => setError(null), 4000);
    }
  };

  // Determine if we can request this book
  const canRequest = !status || status.type === 'denied';

  return (
    <>
      <article
        className="group cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-2xl"
        onClick={() => setShowModal(true)}
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setShowModal(true)}
        role="button"
        aria-label={`View details for ${audiobook.title} by ${audiobook.author}`}
      >
        {/* Cover Container - The Hero */}
        <div className="relative">
          {/* Cover Image with Premium Shadow */}
          <div
            className={`
              relative overflow-hidden rounded-2xl
              shadow-lg shadow-black/20 dark:shadow-black/40
              group-hover:shadow-xl group-hover:shadow-black/25 dark:group-hover:shadow-black/50
              transform group-hover:scale-[1.02] group-hover:-translate-y-1
              transition-all duration-300 ease-out
              ${squareCovers ? 'aspect-square' : 'aspect-[2/3]'}
              ${status?.type === 'available' ? 'ring-2 ring-emerald-400/60 dark:ring-emerald-500/50' : ''}
              ${status?.type === 'processing' ? 'ring-2 ring-amber-400/60 dark:ring-amber-500/50' : ''}
            `}
          >
            {/* Cover Art */}
            {audiobook.coverArtUrl ? (
              <Image
                src={audiobook.coverArtUrl}
                alt=""
                fill
                className="object-cover"
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-800 flex items-center justify-center">
                <svg className="w-12 h-12 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
            )}

            {/* Hover Overlay with Actions - Desktop Only
                pointer-events-none by default so taps on mobile pass through to card
                Only enable pointer-events on devices that support hover */}
            <div className="
              absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent
              opacity-0 pointer-events-none
              [@media(hover:hover)]:group-hover:opacity-100
              [@media(hover:hover)]:group-hover:pointer-events-auto
              transition-opacity duration-300
            ">
              <div className="absolute inset-x-0 bottom-0 p-4 flex flex-col gap-2">
                {/* Quick Action Button */}
                {canRequest ? (
                  <button
                    onClick={handleRequest}
                    disabled={isLoading || !user}
                    className={`
                      w-full py-2.5 px-4 rounded-xl font-semibold text-sm
                      backdrop-blur-md transition-all duration-200
                      ${isLoading
                        ? 'bg-white/20 text-white/70 cursor-wait'
                        : 'bg-white text-gray-900 hover:bg-blue-500 hover:text-white hover:scale-[1.02] hover:shadow-lg hover:shadow-blue-500/25 active:scale-[0.98]'
                      }
                    `}
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Requesting...
                      </span>
                    ) : !user ? 'Sign in to Request' : 'Request'}
                  </button>
                ) : status?.type === 'available' ? (
                  <div className="w-full py-2.5 px-4 rounded-xl font-semibold text-sm text-center bg-emerald-500 text-white backdrop-blur-md shadow-lg shadow-emerald-500/25">
                    In Your Library
                  </div>
                ) : (
                  <div className={`
                    w-full py-2.5 px-4 rounded-xl font-semibold text-sm text-center backdrop-blur-md
                    ${status?.type === 'processing' ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/25' : ''}
                    ${status?.type === 'pending' ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25' : ''}
                    ${status?.type === 'denied' ? 'bg-red-500 text-white shadow-lg shadow-red-500/25' : ''}
                  `}>
                    {status?.type === 'processing' && (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Processing
                      </span>
                    )}
                    {status?.type === 'pending' && 'Requested'}
                    {status?.type === 'denied' && 'Request Denied'}
                  </div>
                )}
              </div>
            </div>

            {/* Subtle Status Indicator (visible when not hovered) */}
            {status && (
              <div className={`
                absolute top-3 right-3 w-3 h-3 rounded-full
                shadow-lg transition-opacity duration-300 group-hover:opacity-0
                ${status.type === 'available' ? 'bg-emerald-400' : ''}
                ${status.type === 'processing' ? 'bg-amber-400 animate-pulse' : ''}
                ${status.type === 'pending' ? 'bg-blue-400' : ''}
                ${status.type === 'denied' ? 'bg-red-400' : ''}
              `} />
            )}

            {/* Rating Badge - Top Left, Elegant */}
            {audiobook.rating && audiobook.rating > 0 && (
              <div className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/50 backdrop-blur-md text-white text-xs font-medium transition-opacity duration-300 group-hover:opacity-0">
                <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <span>{audiobook.rating.toFixed(1)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Metadata - Clean, Minimal */}
        <div className="mt-3 px-1">
          <h3 className="font-semibold text-[15px] leading-snug text-gray-900 dark:text-gray-100 line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors duration-200">
            {audiobook.title}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 truncate">
            {audiobook.author}
          </p>
        </div>

        {/* Toast Notifications - Floating */}
        {(showToast || error) && (
          <div className={`
            fixed bottom-6 left-1/2 -translate-x-1/2 z-50
            px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md
            animate-slide-in-right
            ${showToast ? 'bg-emerald-500/95 text-white' : 'bg-red-500/95 text-white'}
          `}>
            <p className="text-sm font-medium">
              {showToast ? 'Request created!' : error}
            </p>
          </div>
        )}
      </article>

      {/* Details Modal */}
      <AudiobookDetailsModal
        asin={audiobook.asin}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onRequestSuccess={onRequestSuccess}
        onStatusChange={(newStatus) => setLocalRequestStatus(newStatus)}
        isRequested={audiobook.isRequested || localRequestStatus !== undefined}
        requestStatus={displayAudiobook.requestStatus}
        isAvailable={audiobook.isAvailable}
        requestedByUsername={audiobook.requestedByUsername}
        hasReportedIssue={audiobook.hasReportedIssue}
      />
    </>
  );
}
