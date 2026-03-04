/**
 * Component: Watched Lists Section (Profile Page)
 * Documentation: documentation/features/watched-lists.md
 *
 * Shows the user's watched series and watched authors on their profile page
 * with the ability to remove items.
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useWatchedSeries, useDeleteWatchedSeries, WatchedSeriesItem } from '@/lib/hooks/useWatchedSeries';
import { useWatchedAuthors, useDeleteWatchedAuthor, WatchedAuthorItem } from '@/lib/hooks/useWatchedAuthors';
import { usePreferences } from '@/contexts/PreferencesContext';

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// ---------------------------------------------------------------------------
// Watched Series Section
// ---------------------------------------------------------------------------

export function WatchedSeriesSection() {
  const router = useRouter();
  const { series, isLoading } = useWatchedSeries();
  const { deleteSeries, isLoading: isDeleting } = useDeleteWatchedSeries();
  const { squareCovers } = usePreferences();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    try {
      await deleteSeries(id);
      setConfirmDeleteId(null);
    } catch {
      // Error handled by hook
    }
  };

  if (isLoading) {
    return (
      <section>
        <SectionHeader title="Watched Series" icon="series" count={null} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2].map((i) => <CardSkeleton key={i} squareCovers={squareCovers} />)}
        </div>
      </section>
    );
  }

  if (series.length === 0) return null;

  return (
    <section>
      <SectionHeader title="Watched Series" icon="series" count={series.length} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {series.map((item) => (
          <WatchedSeriesCard
            key={item.id}
            item={item}
            squareCovers={squareCovers}
            isDeleting={isDeleting && confirmDeleteId === item.id}
            confirmingDelete={confirmDeleteId === item.id}
            onNavigate={() => router.push(`/series/${item.seriesAsin}`)}
            onConfirmDelete={() => setConfirmDeleteId(item.id)}
            onCancelDelete={() => setConfirmDeleteId(null)}
            onDelete={() => handleDelete(item.id)}
          />
        ))}
      </div>
    </section>
  );
}

function WatchedSeriesCard({
  item, squareCovers, isDeleting, confirmingDelete, onNavigate, onConfirmDelete, onCancelDelete, onDelete,
}: {
  item: WatchedSeriesItem;
  squareCovers: boolean;
  isDeleting: boolean;
  confirmingDelete: boolean;
  onNavigate: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/50 p-4 flex gap-4 hover:shadow-sm transition-shadow">
      {/* Cover */}
      <button onClick={onNavigate} className="flex-shrink-0">
        <div className={`relative w-14 ${squareCovers ? 'aspect-square' : 'aspect-[2/3]'} rounded-lg overflow-hidden bg-gradient-to-br from-emerald-100 to-teal-200 dark:from-emerald-900 dark:to-teal-900`}>
          {item.coverArtUrl ? (
            <Image src={item.coverArtUrl} alt={item.seriesTitle} fill className="object-cover" sizes="56px" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
          )}
        </div>
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <button onClick={onNavigate} className="text-left">
          <h3 className="font-semibold text-gray-900 dark:text-white truncate hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
            {item.seriesTitle}
          </h3>
        </button>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Last checked: {formatRelativeTime(item.lastCheckedAt)}
        </p>
      </div>

      {/* Delete */}
      <div className="flex-shrink-0 flex items-center">
        {confirmingDelete ? (
          <div className="flex items-center gap-1">
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
            >
              {isDeleting ? '...' : 'Remove'}
            </button>
            <button
              onClick={onCancelDelete}
              className="px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={onConfirmDelete}
            className="p-1.5 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50"
            title="Remove from watched"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Watched Authors Section
// ---------------------------------------------------------------------------

export function WatchedAuthorsSection() {
  const router = useRouter();
  const { authors, isLoading } = useWatchedAuthors();
  const { deleteAuthor, isLoading: isDeleting } = useDeleteWatchedAuthor();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    try {
      await deleteAuthor(id);
      setConfirmDeleteId(null);
    } catch {
      // Error handled by hook
    }
  };

  if (isLoading) {
    return (
      <section>
        <SectionHeader title="Watched Authors" icon="author" count={null} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2].map((i) => <CardSkeleton key={i} />)}
        </div>
      </section>
    );
  }

  if (authors.length === 0) return null;

  return (
    <section>
      <SectionHeader title="Watched Authors" icon="author" count={authors.length} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {authors.map((item) => (
          <WatchedAuthorCard
            key={item.id}
            item={item}
            isDeleting={isDeleting && confirmDeleteId === item.id}
            confirmingDelete={confirmDeleteId === item.id}
            onNavigate={() => router.push(`/authors/${item.authorAsin}`)}
            onConfirmDelete={() => setConfirmDeleteId(item.id)}
            onCancelDelete={() => setConfirmDeleteId(null)}
            onDelete={() => handleDelete(item.id)}
          />
        ))}
      </div>
    </section>
  );
}

function WatchedAuthorCard({
  item, isDeleting, confirmingDelete, onNavigate, onConfirmDelete, onCancelDelete, onDelete,
}: {
  item: WatchedAuthorItem;
  isDeleting: boolean;
  confirmingDelete: boolean;
  onNavigate: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/50 p-4 flex gap-4 hover:shadow-sm transition-shadow">
      {/* Avatar */}
      <button onClick={onNavigate} className="flex-shrink-0">
        <div className="relative w-14 h-14 rounded-full overflow-hidden bg-gradient-to-br from-blue-100 to-indigo-200 dark:from-blue-900 dark:to-indigo-900">
          {item.coverArtUrl ? (
            <Image src={item.coverArtUrl} alt={item.authorName} fill className="object-cover" sizes="56px" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </div>
          )}
        </div>
      </button>

      {/* Info */}
      <div className="flex-1 min-w-0 flex items-center">
        <div>
          <button onClick={onNavigate} className="text-left">
            <h3 className="font-semibold text-gray-900 dark:text-white truncate hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
              {item.authorName}
            </h3>
          </button>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            Last checked: {formatRelativeTime(item.lastCheckedAt)}
          </p>
        </div>
      </div>

      {/* Delete */}
      <div className="flex-shrink-0 flex items-center">
        {confirmingDelete ? (
          <div className="flex items-center gap-1">
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 rounded hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
            >
              {isDeleting ? '...' : 'Remove'}
            </button>
            <button
              onClick={onCancelDelete}
              className="px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={onConfirmDelete}
            className="p-1.5 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50"
            title="Remove from watched"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared Components
// ---------------------------------------------------------------------------

function SectionHeader({ title, icon, count }: { title: string; icon: 'series' | 'author'; count: number | null }) {
  const gradientColors = icon === 'series'
    ? 'from-emerald-500 to-teal-500'
    : 'from-blue-500 to-indigo-500';

  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={`w-1 h-6 bg-gradient-to-b ${gradientColors} rounded-full`} />
      <h2 className="text-xl font-bold text-gray-900 dark:text-white">
        {title}
      </h2>
      {count !== null && (
        <span className="text-sm text-gray-500 dark:text-gray-400">({count})</span>
      )}
    </div>
  );
}

function CardSkeleton({ squareCovers }: { squareCovers?: boolean }) {
  return (
    <div className="rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700/50 p-4 flex gap-4 animate-pulse">
      <div className={`w-14 ${squareCovers ? 'aspect-square' : 'aspect-[2/3]'} rounded-lg bg-gray-200 dark:bg-gray-700`} />
      <div className="flex-1 space-y-2 py-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
      </div>
    </div>
  );
}
