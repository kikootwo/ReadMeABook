/**
 * Component: Audiobook Grid
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React from 'react';
import { AudiobookCard } from './AudiobookCard';
import { Audiobook } from '@/lib/hooks/useAudiobooks';

interface AudiobookGridProps {
  audiobooks: Audiobook[];
  isLoading?: boolean;
  emptyMessage?: string;
  onRequestSuccess?: () => void;
}

export function AudiobookGrid({
  audiobooks,
  isLoading = false,
  emptyMessage = 'No audiobooks found',
  onRequestSuccess,
}: AudiobookGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 md:gap-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (audiobooks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <svg
          className="w-16 h-16 text-gray-400 mb-4"
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
        <p className="text-gray-600 dark:text-gray-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 md:gap-6">
      {audiobooks.map((audiobook) => (
        <AudiobookCard
          key={audiobook.asin}
          audiobook={audiobook}
          onRequestSuccess={onRequestSuccess}
        />
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden animate-pulse">
      {/* Cover Art Skeleton */}
      <div className="aspect-[2/3] bg-gray-200 dark:bg-gray-700" />

      {/* Content Skeleton */}
      <div className="p-4 space-y-3">
        {/* Title */}
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />

        {/* Author */}
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />

        {/* Metadata */}
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />

        {/* Button */}
        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    </div>
  );
}
