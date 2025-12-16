/**
 * Component: Audiobook Details Modal
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/requests/StatusBadge';
import { useAudiobookDetails } from '@/lib/hooks/useAudiobooks';
import { useCreateRequest } from '@/lib/hooks/useRequests';
import { useAuth } from '@/contexts/AuthContext';

interface AudiobookDetailsModalProps {
  asin: string;
  isOpen: boolean;
  onClose: () => void;
  onRequestSuccess?: () => void;
  isRequested?: boolean;
  requestStatus?: string | null;
  isAvailable?: boolean;
  requestedByUsername?: string | null;
}

export function AudiobookDetailsModal({
  asin,
  isOpen,
  onClose,
  onRequestSuccess,
  isRequested = false,
  requestStatus = null,
  isAvailable = false,
  requestedByUsername = null,
}: AudiobookDetailsModalProps) {
  const { user } = useAuth();
  const { audiobook, isLoading, error } = useAudiobookDetails(isOpen ? asin : null);
  const { createRequest, isLoading: isRequesting } = useCreateRequest();
  const [showToast, setShowToast] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const handleRequest = async () => {
    if (!user || !audiobook) {
      setRequestError('Please log in to request audiobooks');
      return;
    }

    try {
      await createRequest(audiobook);
      setShowToast(true);
      setTimeout(() => {
        setShowToast(false);
        onClose();
      }, 2000);
      onRequestSuccess?.();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Failed to create request');
      setTimeout(() => setRequestError(null), 5000);
    }
  };

  const formatDuration = (minutes?: number) => {
    if (!minutes) return null;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours} hr ${mins} min`;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return null;
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          aria-label="Close modal"
        >
          <svg
            className="w-6 h-6 text-gray-600 dark:text-gray-400"
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
        </button>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="p-8">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
              <p className="text-red-800 dark:text-red-200 font-medium">
                Failed to load audiobook details
              </p>
              <p className="text-red-700 dark:text-red-300 text-sm mt-2">
                Please try again later
              </p>
            </div>
          </div>
        )}

        {/* Content */}
        {audiobook && !isLoading && (
          <div className="p-4 sm:p-6 md:p-8 space-y-4 sm:space-y-6">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row gap-4 sm:gap-6">
              {/* Cover Art */}
              <div className="flex-shrink-0 mx-auto md:mx-0">
                <div className="relative w-32 sm:w-40 md:w-48 aspect-[2/3] bg-gray-200 dark:bg-gray-700 rounded-lg overflow-hidden shadow-lg">
                  {audiobook.coverArtUrl ? (
                    <Image
                      src={audiobook.coverArtUrl}
                      alt={`Cover art for ${audiobook.title}`}
                      fill
                      className="object-cover"
                      sizes="192px"
                      priority
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
                </div>
              </div>

              {/* Metadata */}
              <div className="flex-1 space-y-3 sm:space-y-4 text-center md:text-left">
                {/* Title */}
                <div>
                  <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
                    {audiobook.title}
                  </h2>
                </div>

                {/* Author */}
                <div className="space-y-1">
                  <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">By</p>
                  <p className="text-base sm:text-lg text-gray-700 dark:text-gray-300 font-medium">
                    {audiobook.author}
                  </p>
                </div>

                {/* Narrator */}
                {audiobook.narrator && (
                  <div className="space-y-1">
                    <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Narrated by</p>
                    <p className="text-base sm:text-lg text-gray-700 dark:text-gray-300">
                      {audiobook.narrator}
                    </p>
                  </div>
                )}

                {/* Metadata Grid */}
                <div className="grid grid-cols-2 gap-4 pt-2">
                  {/* Rating */}
                  {audiobook.rating && (
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Rating</p>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1">
                          {[...Array(5)].map((_, i) => (
                            <svg
                              key={i}
                              className={`w-5 h-5 ${
                                i < Math.floor(Number(audiobook.rating))
                                  ? 'text-yellow-400 fill-current'
                                  : 'text-gray-300 dark:text-gray-600'
                              }`}
                              viewBox="0 0 20 20"
                            >
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                            </svg>
                          ))}
                        </div>
                        <span className="text-gray-700 dark:text-gray-300 font-medium">
                          {Number(audiobook.rating).toFixed(1)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Duration */}
                  {audiobook.durationMinutes && (
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Length</p>
                      <p className="text-gray-700 dark:text-gray-300 font-medium">
                        {formatDuration(audiobook.durationMinutes)}
                      </p>
                    </div>
                  )}

                  {/* Release Date */}
                  {audiobook.releaseDate && (
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Release Date</p>
                      <p className="text-gray-700 dark:text-gray-300">
                        {formatDate(audiobook.releaseDate)}
                      </p>
                    </div>
                  )}

                  {/* Availability Status */}
                  {isAvailable && (
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Status</p>
                      <div className="inline-flex items-center gap-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-semibold px-3 py-1 rounded-full">
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span>In Your Library</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Genres */}
                {audiobook.genres && audiobook.genres.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Genres</p>
                    <div className="flex flex-wrap gap-2">
                      {audiobook.genres.map((genre: string) => (
                        <span
                          key={genre}
                          className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-sm rounded-full"
                        >
                          {genre}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Description */}
            {audiobook.description && (
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4 sm:pt-6">
                <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2 sm:mb-3">
                  Publisher's Summary
                </h3>
                <div className="text-sm sm:text-base text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                  {audiobook.description}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4 sm:pt-6 flex flex-col sm:flex-row gap-2 sm:gap-3">
              {(() => {
                // Use props from card instead of fetched audiobook data for request status
                // Check if book is already available in library or completed status
                if (isAvailable || requestStatus === 'completed') {
                  return (
                    <div className="flex-1">
                      <div className="w-full py-3 px-6 bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-800 rounded-lg text-center">
                        <span className="text-base font-semibold text-green-700 dark:text-green-400">
                          Available in Your Library
                        </span>
                      </div>
                    </div>
                  );
                }

                // Check if book is requested and in progress
                const inProgressStatuses = [
                  'pending',
                  'awaiting_search',
                  'searching',
                  'downloading',
                  'processing',
                  'awaiting_import',
                ];
                if (
                  isRequested &&
                  requestStatus &&
                  inProgressStatuses.includes(requestStatus)
                ) {
                  // Show who requested it
                  const buttonText = requestedByUsername
                    ? `Requested by ${requestedByUsername}`
                    : 'Already Requested';

                  return (
                    <div className="flex-1">
                      <Button
                        onClick={() => {}}
                        disabled={true}
                        variant="primary"
                        size="lg"
                        className="w-full cursor-not-allowed opacity-75"
                      >
                        {buttonText}
                      </Button>
                    </div>
                  );
                }

                // For failed/warn/cancelled or no request - show Request button
                return (
                  <div className="flex-1">
                    <Button
                      onClick={handleRequest}
                      loading={isRequesting}
                      disabled={!user}
                      variant="primary"
                      size="lg"
                      className="w-full"
                    >
                      {!user ? 'Login to Request' : 'Request Audiobook'}
                    </Button>
                  </div>
                );
              })()}

              <Button onClick={onClose} variant="outline" size="lg">
                Close
              </Button>
            </div>

            {/* Error Message */}
            {requestError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-red-800 dark:text-red-200 text-center">{requestError}</p>
              </div>
            )}

            {/* Success Toast */}
            {showToast && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <p className="text-green-800 dark:text-green-200 text-center font-medium">
                  ✓ Request created successfully!
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
