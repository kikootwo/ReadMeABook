/**
 * Component: Audiobook Card
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/requests/StatusBadge';
import { AudiobookDetailsModal } from '@/components/audiobooks/AudiobookDetailsModal';
import { useCreateRequest } from '@/lib/hooks/useRequests';
import { useAuth } from '@/contexts/AuthContext';
import { Audiobook } from '@/lib/hooks/useAudiobooks';

interface AudiobookCardProps {
  audiobook: Audiobook;
  isRequested?: boolean;
  requestStatus?: string;
  onRequestSuccess?: () => void;
}

export function AudiobookCard({
  audiobook,
  isRequested = false,
  requestStatus,
  onRequestSuccess,
}: AudiobookCardProps) {
  const { user } = useAuth();
  const { createRequest, isLoading } = useCreateRequest();
  const [showToast, setShowToast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);

  const handleRequest = async () => {
    if (!user) {
      setError('Please log in to request audiobooks');
      return;
    }

    try {
      await createRequest(audiobook);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
      onRequestSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create request');
      setTimeout(() => setError(null), 5000);
    }
  };

  const formatDuration = (minutes?: number) => {
    if (!minutes) return null;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  return (
    <>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
        {/* Cover Art - Clickable */}
        <div
          className="relative aspect-[2/3] bg-gray-200 dark:bg-gray-700 cursor-pointer group"
          onClick={() => setShowModal(true)}
        >
          {audiobook.coverArtUrl ? (
            <Image
              src={audiobook.coverArtUrl}
              alt={`Cover art for ${audiobook.title}`}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <svg
                className="w-16 h-16"
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

          {/* Hover overlay for click hint */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 dark:bg-gray-900/90 rounded-full p-3">
              <svg className="w-6 h-6 text-gray-900 dark:text-gray-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
          </div>

          {/* Availability Badge */}
          {audiobook.isAvailable && (
            <div className="absolute top-2 right-2 bg-green-500 text-white text-xs font-semibold px-2 py-1 rounded-md shadow-lg flex items-center gap-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Available</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-4 space-y-2">
          {/* Title - Clickable */}
          <h3
            className="font-semibold text-gray-900 dark:text-gray-100 line-clamp-2 min-h-[3rem] cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            onClick={() => setShowModal(true)}
          >
            {audiobook.title}
          </h3>

        {/* Author */}
        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-1">
          By {audiobook.author}
        </p>

        {/* Narrator */}
        {audiobook.narrator && (
          <p className="text-xs text-gray-500 dark:text-gray-500 line-clamp-1">
            Narrated by {audiobook.narrator}
          </p>
        )}

        {/* Metadata Row */}
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          {audiobook.rating && (
            <div className="flex items-center gap-1">
              <svg className="w-4 h-4 text-yellow-400 fill-current" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <span>{audiobook.rating.toFixed(1)}</span>
            </div>
          )}
          {audiobook.durationMinutes && (
            <span>{formatDuration(audiobook.durationMinutes)}</span>
          )}
        </div>

        {/* Status or Action */}
        <div className="pt-2">
          {(() => {
            // Check if book is already available in Plex or completed/available status
            if (audiobook.isAvailable || audiobook.requestStatus === 'completed') {
              return (
                <div className="w-full py-2 px-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md text-center">
                  <span className="text-sm font-medium text-green-700 dark:text-green-400">
                    In Your Library
                  </span>
                </div>
              );
            }

            // Check if book is requested and in progress (non-re-requestable statuses)
            const inProgressStatuses = ['pending', 'awaiting_search', 'searching', 'downloading', 'processing', 'awaiting_import'];
            if (audiobook.isRequested && audiobook.requestStatus && inProgressStatuses.includes(audiobook.requestStatus)) {
              // Show who requested it
              const buttonText = audiobook.requestedByUsername
                ? `Requested by ${audiobook.requestedByUsername}`
                : 'Requested';

              return (
                <Button
                  onClick={() => {}}
                  disabled={true}
                  variant="primary"
                  size="md"
                  className="w-full cursor-not-allowed opacity-75"
                >
                  {buttonText}
                </Button>
              );
            }

            // For failed/warn/cancelled or no request - show Request button
            return (
              <Button
                onClick={handleRequest}
                loading={isLoading}
                disabled={!user}
                variant="primary"
                size="md"
                className="w-full"
              >
                {!user ? 'Login to Request' : 'Request'}
              </Button>
            );
          })()}
        </div>

        {/* Error Message */}
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 text-center">{error}</p>
        )}

        {/* Success Toast */}
        {showToast && (
          <p className="text-xs text-green-600 dark:text-green-400 text-center font-medium">
            ✓ Request created successfully!
          </p>
        )}
      </div>
    </div>

    {/* Details Modal */}
    <AudiobookDetailsModal
      asin={audiobook.asin}
      isOpen={showModal}
      onClose={() => setShowModal(false)}
      onRequestSuccess={onRequestSuccess}
      isRequested={audiobook.isRequested}
      requestStatus={audiobook.requestStatus}
      isAvailable={audiobook.isAvailable}
      requestedByUsername={audiobook.requestedByUsername}
    />
    </>
  );
}
