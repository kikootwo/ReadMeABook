/**
 * Component: Watch Button (Series / Author)
 * Documentation: documentation/features/watched-lists.md
 *
 * Reusable toggle button for watching/unwatching a series or author.
 * Shows a confirmation modal before watching. Unwatching is instant.
 */

'use client';

import React, { useState } from 'react';
import { useWatchedSeries, useAddWatchedSeries, useDeleteWatchedSeries } from '@/lib/hooks/useWatchedSeries';
import { useWatchedAuthors, useAddWatchedAuthor, useDeleteWatchedAuthor } from '@/lib/hooks/useWatchedAuthors';
import { ConfirmModal } from './ConfirmModal';

interface WatchSeriesButtonProps {
  seriesAsin: string;
  seriesTitle: string;
  coverArtUrl?: string;
}

export function WatchSeriesButton({ seriesAsin, seriesTitle, coverArtUrl }: WatchSeriesButtonProps) {
  const { series } = useWatchedSeries();
  const { addSeries, isLoading: isAdding } = useAddWatchedSeries();
  const { deleteSeries, isLoading: isDeleting } = useDeleteWatchedSeries();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const watchedEntry = series.find((s) => s.seriesAsin === seriesAsin);
  const isWatching = !!watchedEntry;
  const isLoading = isAdding || isDeleting;

  const handleClick = async () => {
    setError(null);
    if (isWatching && watchedEntry) {
      // Unwatch immediately (no confirmation needed)
      try {
        await deleteSeries(watchedEntry.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      }
    } else {
      // Show confirmation before watching
      setShowConfirm(true);
    }
  };

  const handleConfirmWatch = async () => {
    setShowConfirm(false);
    setError(null);
    try {
      await addSeries(seriesAsin, seriesTitle, coverArtUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="inline-flex flex-col items-start">
      <button
        onClick={handleClick}
        disabled={isLoading}
        className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
          isWatching
            ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-700/50'
            : 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-700 dark:hover:text-emerald-300 border border-gray-200 dark:border-gray-600/50 hover:border-emerald-200 dark:hover:border-emerald-700/50'
        } ${isLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        {isLoading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : isWatching ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
        {isWatching ? 'Watching' : 'Watch Series'}
      </button>
      {error && (
        <span className="text-xs text-red-500 mt-1">{error}</span>
      )}
      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmWatch}
        title={`Watch "${seriesTitle}"?`}
        message={`This will request all books in "${seriesTitle}" that aren't already in your library, and automatically request new releases as they're added to the series. Continue?`}
        confirmText="Watch"
        isLoading={isAdding}
      />
    </div>
  );
}

interface WatchAuthorButtonProps {
  authorAsin: string;
  authorName: string;
  coverArtUrl?: string;
}

export function WatchAuthorButton({ authorAsin, authorName, coverArtUrl }: WatchAuthorButtonProps) {
  const { authors } = useWatchedAuthors();
  const { addAuthor, isLoading: isAdding } = useAddWatchedAuthor();
  const { deleteAuthor, isLoading: isDeleting } = useDeleteWatchedAuthor();
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const watchedEntry = authors.find((a) => a.authorAsin === authorAsin);
  const isWatching = !!watchedEntry;
  const isLoading = isAdding || isDeleting;

  const handleClick = async () => {
    setError(null);
    if (isWatching && watchedEntry) {
      // Unwatch immediately (no confirmation needed)
      try {
        await deleteAuthor(watchedEntry.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed');
      }
    } else {
      // Show confirmation before watching
      setShowConfirm(true);
    }
  };

  const handleConfirmWatch = async () => {
    setShowConfirm(false);
    setError(null);
    try {
      await addAuthor(authorAsin, authorName, coverArtUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="inline-flex flex-col items-start">
      <button
        onClick={handleClick}
        disabled={isLoading}
        className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
          isWatching
            ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-700/50'
            : 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-700 dark:hover:text-blue-300 border border-gray-200 dark:border-gray-600/50 hover:border-blue-200 dark:hover:border-blue-700/50'
        } ${isLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        {isLoading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : isWatching ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
        {isWatching ? 'Watching' : 'Watch Author'}
      </button>
      {error && (
        <span className="text-xs text-red-500 mt-1">{error}</span>
      )}
      <ConfirmModal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleConfirmWatch}
        title={`Watch "${authorName}"?`}
        message={`This will request all books by "${authorName}" that aren't already in your library, and automatically request new releases. Continue?`}
        confirmText="Watch"
        isLoading={isAdding}
      />
    </div>
  );
}
